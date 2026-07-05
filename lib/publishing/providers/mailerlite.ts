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
//
// The API key is the only MailerLite credential; it resolves from the brand's
// connection (encrypted) with env-var fallback. Sender identity lives on the
// brand row (Brand basics), and group IDs live on the connection. Deliberately
// creates the campaign WITHOUT scheduling it: approval here covers the
// content; the actual send (audience, timing) is confirmed in MailerLite. The
// separate POST /campaigns/{id}/schedule call is the future "send now" surface.

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

    return {
      externalId: String(id),
      url: `https://dashboard.mailerlite.com/campaigns/${id}`,
    };
  },
};
