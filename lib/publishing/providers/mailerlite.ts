import "server-only";
import { resolvePlain, resolveSecret } from "../credentials";
import { logError } from "@/lib/log";
import type { Brand, BrandIntegration, PerformanceMetric } from "@/lib/db/types";
import type {
  FetchStatsInput,
  ProviderField,
  PublishInput,
  PublishProvider,
  PublishResult,
  PublishSchedule,
  ScheduleExistingInput,
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
//   GET https://connect.mailerlite.com/api/campaigns/{id}
//   → 200 with { data: { default_email_id, emails: [{ id, stats: { sent,
//       opens_count, unique_opens_count, open_rate: { float, string },
//       clicks_count, unique_clicks_count, click_rate: { float, string },
//       ... } }] } } — stats live per-email (an A/B campaign has more than
//     one), NOT on the campaign object itself; match default_email_id.
//     Rate fields are objects, not plain numbers; read .float.
//
// The API key is the only MailerLite credential; it resolves from the brand's
// connection (encrypted) with env-var fallback. Sender identity lives on the
// brand row (Brand basics), and group IDs live on the connection.
//
// Approving in the app is the one explicit human act; it now drives MailerLite's
// actual send/schedule too, so there's no second manual step inside MailerLite's
// own dashboard. timezone_id is deliberately omitted: schedule() relies on
// MailerLite's account-default timezone rather than adding a timezone setting
// to this app. NOTE: that means a scheduled time is interpreted in the
// MailerLite account's timezone, not the browser's — a time chosen close to
// "now" can be rejected as not in the future.
//
// Create and deliver are two calls, and only the second one is retryable: a
// failed schedule leaves a real campaign behind, so deliverCampaign() is
// exposed again via scheduleExisting() (see lib/pipeline/publish.ts) instead of
// re-running publish() and creating a duplicate.

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
    hint: "Audience group IDs to send to. Required: a campaign with no group can be created but never sent.",
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

const campaignUrl = (id: string) =>
  `https://dashboard.mailerlite.com/campaigns/${id}`;

/**
 * Runs the send/schedule step for a campaign that already exists in MailerLite.
 * Shared by publish() (right after create) and scheduleExisting() (retry of a
 * campaign whose earlier delivery failed) so the request shape and the failure
 * handling exist in exactly one place.
 *
 * Failure is deliberately RETURNED, not thrown: the campaign already exists, so
 * throwing would send callers back through POST /campaigns and create a
 * duplicate. Status "draft" means "created, not delivered" and is what makes the
 * campaign eligible for a scheduleExisting() retry later.
 */
async function deliverCampaign(
  id: string,
  schedule: PublishSchedule | undefined,
  apiKey: string,
  groupIds: string[] | undefined,
): Promise<PublishResult> {
  const url = campaignUrl(id);
  const s = schedule ?? { type: "instant" as const };
  const body =
    s.type === "scheduled"
      ? {
          delivery: "scheduled",
          schedule: { date: s.date, hours: s.hours, minutes: s.minutes },
        }
      : { delivery: "instant" };

  const res = await fetch(`${API_BASE}/campaigns/${id}/schedule`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    // Log the raw rejection: this used to surface only in a toast, which meant
    // the one piece of information needed to diagnose a failed schedule was
    // gone the moment the toast cleared.
    logError(
      "publish:mailerlite:schedule",
      `MailerLite schedule failed (${res.status}): ${responseBody.slice(0, 400)}`,
      {
        campaignId: id,
        delivery: body.delivery,
        groupCount: groupIds?.length ?? 0,
      },
    );
    return {
      externalId: id,
      url,
      status: "draft",
      scheduleError: `MailerLite schedule failed (${res.status}): ${responseBody.slice(0, 400)}`,
    };
  }

  if (s.type === "scheduled") {
    return {
      externalId: id,
      url,
      status: "scheduled",
      // Naive local timestamp for display only; the actual delivery time is
      // whatever MailerLite's account timezone resolves this wall-clock
      // time to.
      scheduledFor: `${s.date}T${s.hours}:${s.minutes}:00`,
    };
  }

  return { externalId: id, url, status: "sent" };
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
    if (!ml.groupIds?.length) {
      // Thrown BEFORE POST /campaigns, so nothing is created and there's no
      // orphan to clean up. A campaign with no audience is created happily by
      // MailerLite but cannot be scheduled or sent ("campaign settings
      // missing"), which surfaced as an unexplained schedule failure.
      throw new Error(
        "MailerLite has no audience group selected. Add a group ID in Settings → Connections.",
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

    return deliverCampaign(String(id), input.schedule, ml.apiKey, ml.groupIds);
  },

  async scheduleExisting(input: ScheduleExistingInput): Promise<PublishResult> {
    const ml = resolveMailerliteConfig(input.brand, input.integration);
    if (!ml.apiKey) {
      throw new Error(
        "MailerLite is not connected. Add an API key in Settings → Connections.",
      );
    }
    return deliverCampaign(
      input.externalId,
      input.schedule,
      ml.apiKey,
      ml.groupIds,
    );
  },

  async fetchStats(input: FetchStatsInput): Promise<PerformanceMetric[]> {
    const ml = resolveMailerliteConfig(input.brand, input.integration);
    if (!ml.apiKey) {
      throw new Error(
        "MailerLite is not connected. Add an API key in Settings → Connections.",
      );
    }

    const res = await fetch(`${API_BASE}/campaigns/${input.externalId}`, {
      headers: {
        Authorization: `Bearer ${ml.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `MailerLite campaign fetch failed (${res.status}): ${body.slice(0, 400)}`,
      );
    }

    type EmailStats = {
      sent?: number;
      opens_count?: number;
      unique_opens_count?: number;
      open_rate?: { float?: number };
      clicks_count?: number;
      unique_clicks_count?: number;
      click_rate?: { float?: number };
    };
    const data = (await res.json()) as {
      data?: {
        default_email_id?: string | number;
        emails?: { id?: string | number; stats?: EmailStats }[];
      };
    };
    // Stats live per-email, not on the campaign itself (a campaign can carry
    // more than one email for an A/B test); match the one actually sent.
    const campaign = data.data;
    const stats =
      campaign?.emails?.find(
        (e) => String(e.id) === String(campaign.default_email_id),
      )?.stats ?? campaign?.emails?.[0]?.stats;
    if (!stats) return [];

    return [
      { metric: "sent", value: stats.sent ?? 0 },
      { metric: "opens", value: stats.unique_opens_count ?? 0 },
      { metric: "open_rate", value: stats.open_rate?.float ?? 0 },
      { metric: "clicks", value: stats.unique_clicks_count ?? 0 },
      { metric: "click_rate", value: stats.click_rate?.float ?? 0 },
    ];
  },
};
