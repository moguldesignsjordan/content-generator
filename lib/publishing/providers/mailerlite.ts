import "server-only";
import { resolvePlain, resolveSecret } from "../credentials";
import type { Brand, BrandIntegration } from "@/lib/db/types";
import type {
  ProviderField,
  PublishInput,
  PublishProvider,
  PublishResult,
} from "../provider";

// API shape verified against developers.mailerlite.com (campaigns docs):
//   POST https://connect.mailerlite.com/api/campaigns
//   Authorization: Bearer <apiKey>
//   { name, type: "regular", emails: [{ subject, from_name, from, content }],
//     groups: [...] }  → 200 with { data: { id } }
//   POST https://connect.mailerlite.com/api/campaigns/{id}/schedule
//   { delivery: "instant" }
//     or { delivery: "scheduled", schedule: { date, hours, minutes, timezone_id? } }
//   → 200 with { data: { status: "sent" | "ready" | ... } }
//
// The API key is the only MailerLite credential; it resolves from the brand's
// connection (encrypted) with env-var fallback. Sender identity lives on the
// brand row (Brand basics), and group IDs live on the connection.
//
// Approving in the app is the one explicit human act; it now drives MailerLite's
// actual send/schedule too, so there's no second manual step inside MailerLite's
// own dashboard. timezone_id is deliberately omitted: schedule() relies on
// MailerLite's account-default timezone rather than adding a timezone setting
// to this app.

const API_BASE = "https://connect.mailerlite.com/api";

export const MAILERLITE_FIELDS: ProviderField[] = [
  {
    key: "apiKey",
    label: "API key",
    secret: true,
    envVar: "MAILERLITE_API_KEY",
    hint: "Found in MailerLite under Integrations → API. Leave blank to keep the saved value.",
  },
  {
    key: "groupIds",
    label: "Group IDs",
    list: true,
    optional: true,
    hint: "Audience group IDs to target. Optional.",
  },
];

interface ResolvedMailerlite {
  apiKey?: string;
  senderName?: string;
  senderEmail?: string;
  groupIds?: string[];
}

/** Assembles the full MailerLite config from the brand + connection + env. */
export function resolveMailerliteConfig(
  brand: Brand,
  integration: BrandIntegration | null,
): ResolvedMailerlite {
  const ml = brand.mailerlite_config ?? {};
  return {
    apiKey: resolveSecret(integration, "apiKey", "MAILERLITE_API_KEY"),
    senderName: ml.sender_name,
    senderEmail: ml.sender_email,
    // Per-connection list, falling back to the legacy brand-column value.
    groupIds: resolvePlain<string[]>(integration, "groupIds", ml.group_ids),
  };
}

export const mailerliteProvider: PublishProvider = {
  id: "mailerlite",
  kind: "email",
  label: "MailerLite (email)",
  configHint: "MAILERLITE_API_KEY (+ sender + group in brand settings)",
  fields: MAILERLITE_FIELDS,

  isConfigured: (brand, integration) =>
    Boolean(resolveMailerliteConfig(brand, integration).apiKey),

  async publish(input: PublishInput): Promise<PublishResult> {
    const { content, brand, integration } = input;
    const ml = resolveMailerliteConfig(brand, integration);

    if (!ml.apiKey) {
      throw new Error(
        "MailerLite is not connected. Add an API key in Settings → Connections.",
      );
    }
    if (!ml.senderEmail || !ml.senderName) {
      throw new Error(
        "MailerLite sender is not set. Add sender name and a verified sender email in Settings.",
      );
    }
    if (!content.html.includes("{$unsubscribe}")) {
      // The pipeline guarantees this; check again at the boundary anyway.
      throw new Error("Email HTML is missing the {$unsubscribe} merge tag.");
    }

    const res = await fetch(`${API_BASE}/campaigns`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ml.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: content.subject.slice(0, 255) || `Content Engine ${input.jobId}`,
        type: "regular",
        emails: [
          {
            subject: content.subject,
            from_name: ml.senderName,
            from: ml.senderEmail,
            content: content.html,
          },
        ],
        ...(ml.groupIds?.length ? { groups: ml.groupIds } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `MailerLite campaign create failed (${res.status}): ${body.slice(0, 400)}`,
      );
    }

    const data = (await res.json()) as { data?: { id?: string | number } };
    const id = data.data?.id;
    if (id === undefined || id === null) {
      throw new Error("MailerLite response had no campaign id.");
    }

    const url = `https://dashboard.mailerlite.com/campaigns/${id}`;

    // Deliberately not thrown on failure: the campaign above already exists
    // in MailerLite, so throwing here would make a retry call POST /campaigns
    // again and create a duplicate. Returning status "draft" instead lets the
    // pipeline still record the publication (idempotent on retry) while
    // surfacing that delivery needs to be finished manually in MailerLite.
    const schedule = input.schedule ?? { type: "instant" as const };
    const scheduleRes = await fetch(`${API_BASE}/campaigns/${id}/schedule`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ml.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        schedule.type === "scheduled"
          ? {
              delivery: "scheduled",
              schedule: {
                date: schedule.date,
                hours: schedule.hours,
                minutes: schedule.minutes,
              },
            }
          : { delivery: "instant" },
      ),
    });

    if (!scheduleRes.ok) {
      const body = await scheduleRes.text().catch(() => "");
      return {
        externalId: String(id),
        url,
        status: "draft",
        scheduleError: `MailerLite schedule failed (${scheduleRes.status}): ${body.slice(0, 400)}`,
      };
    }

    if (schedule.type === "scheduled") {
      return {
        externalId: String(id),
        url,
        status: "scheduled",
        // Naive local timestamp for display only; the actual delivery time is
        // whatever MailerLite's account timezone resolves this wall-clock
        // time to.
        scheduledFor: `${schedule.date}T${schedule.hours}:${schedule.minutes}:00`,
      };
    }

    return { externalId: String(id), url, status: "sent" };
  },
};
