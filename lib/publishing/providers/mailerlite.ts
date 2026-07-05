import "server-only";
import type { PublishInput, PublishProvider, PublishResult } from "../provider";

// API shape verified against developers.mailerlite.com (campaigns docs):
//   POST https://connect.mailerlite.com/api/campaigns
//   Authorization: Bearer <MAILERLITE_API_KEY>
//   { name, type: "regular", emails: [{ subject, from_name, from, content }],
//     groups: [...] }  → 200 with { data: { id } }
//
// Deliberately creates the campaign WITHOUT scheduling it: approval here
// covers the content; the actual send (audience, timing) is confirmed in
// MailerLite. The separate POST /campaigns/{id}/schedule call is the future
// "send now" surface.

const API_BASE = "https://connect.mailerlite.com/api";

export const mailerliteProvider: PublishProvider = {
  id: "mailerlite",
  kind: "email",
  label: "MailerLite (email)",
  configHint: "MAILERLITE_API_KEY (+ sender + group in brand settings)",

  isConfigured: () => Boolean(process.env.MAILERLITE_API_KEY),

  async publish(input: PublishInput): Promise<PublishResult> {
    const { content, brand } = input;
    const ml = brand.mailerlite_config ?? {};
    if (!ml.sender_email || !ml.sender_name) {
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
        Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: content.subject.slice(0, 255) || `Content Engine ${input.jobId}`,
        type: "regular",
        emails: [
          {
            subject: content.subject,
            from_name: ml.sender_name,
            from: ml.sender_email,
            content: content.html,
          },
        ],
        ...(ml.group_ids?.length ? { groups: ml.group_ids } : {}),
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
