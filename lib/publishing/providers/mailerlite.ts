import "server-only";
import { resolvePlain, resolveSecret } from "../credentials";
import { logError } from "@/lib/log";
import type {
  Brand,
  BrandIntegration,
  EmailDraftContent,
  PerformanceMetric,
} from "@/lib/db/types";
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
      // 410/404 means the campaign no longer exists at MailerLite (deleted or
      // expired after creation) — retrying the same id will fail forever.
      gone: res.status === 410 || res.status === 404,
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

/**
 * The campaign body MailerLite wants, shared by create (POST /campaigns) and
 * edit (PUT /campaigns/{id}) — the two take the same shape, so building it in
 * one place is what keeps an updated campaign identical to a freshly created
 * one rather than a slightly different second implementation.
 */
function campaignBody(
  content: EmailDraftContent,
  ml: ResolvedMailerlite,
  fallbackName: string,
) {
  return {
    name: content.subject.slice(0, 255) || fallbackName,
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
  };
}

/**
 * Everything that must be true before we touch MailerLite's campaign
 * endpoints. Throws BEFORE any create/update call, so a rejected send never
 * leaves an orphan or a half-edited campaign behind.
 */
function assertSendable(ml: ResolvedMailerlite, content: EmailDraftContent) {
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
    // A campaign with no audience is created happily by MailerLite but cannot
    // be scheduled or sent ("campaign settings missing"), which surfaced as an
    // unexplained schedule failure.
    throw new Error(
      "MailerLite has no audience group selected. Add a group ID in Settings → Connections.",
    );
  }
  if (!content.html.includes("{$unsubscribe}")) {
    // The pipeline guarantees this; check again at the boundary anyway.
    throw new Error("Email HTML is missing the {$unsubscribe} merge tag.");
  }
}

/** POST /campaigns → the new campaign id. */
async function createCampaign(
  content: EmailDraftContent,
  ml: ResolvedMailerlite,
  fallbackName: string,
): Promise<string> {
  const res = await fetch(`${API_BASE}/campaigns`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ml.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(campaignBody(content, ml, fallbackName)),
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
  return String(id);
}

/**
 * Current campaign status at MailerLite, or "gone" when the id no longer
 * exists there. This is the gate for editing: MailerLite only accepts PUT on a
 * campaign in "draft" status, a "ready" (scheduled) one has to be cancelled
 * back to draft first, and a sent one can never be edited at all.
 */
async function fetchCampaignStatus(
  id: string,
  apiKey: string,
): Promise<{ status: string } | { gone: true }> {
  const res = await fetch(`${API_BASE}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 410) return { gone: true };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `MailerLite campaign fetch failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const data = (await res.json()) as { data?: { status?: string } };
  return { status: data.data?.status ?? "draft" };
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
    assertSendable(ml, content);

    const id = await createCampaign(
      content,
      ml,
      `Content Engine ${input.jobId}`,
    );
    return deliverCampaign(id, input.schedule, ml.apiKey!, ml.groupIds);
  },

  /**
   * Pushes the draft's current content over the existing campaign and delivers
   * it again, so approving is not a one-way door: a typo caught after the fact
   * is fixed and re-sent from this app, never by rebuilding the email inside
   * MailerLite's own editor.
   *
   * Three cases, decided by the campaign's live status (never by our stored
   * one, which goes stale the moment anyone touches MailerLite directly):
   *  - draft: PUT the new content, then deliver.
   *  - ready (scheduled): cancel back to draft first, since MailerLite refuses
   *    PUT on anything but a draft, then PUT and re-schedule.
   *  - sent: unfixable at MailerLite. Refused outright unless the caller
   *    explicitly opted into allowRecreate, which sends a NEW campaign to the
   *    same audience (a second email in their inbox, so it stays a deliberate
   *    human choice, not a retry side effect).
   * A campaign that's gone (deleted at MailerLite) is recreated the same way.
   */
  async updatePublished(input): Promise<PublishResult> {
    const { content, brand, integration, externalId, allowRecreate } = input;
    const ml = resolveMailerliteConfig(brand, integration);
    assertSendable(ml, content);
    const apiKey = ml.apiKey!;

    const recreate = async (): Promise<PublishResult> => {
      const newId = await createCampaign(
        content,
        ml,
        `Content Engine ${input.jobId}`,
      );
      const delivered = await deliverCampaign(
        newId,
        input.schedule,
        apiKey,
        ml.groupIds,
      );
      return { ...delivered, recreated: true };
    };

    const live = await fetchCampaignStatus(externalId, apiKey);
    if ("gone" in live) return recreate();

    if (live.status !== "draft" && live.status !== "ready") {
      // "sent"/"finished"/"started"/"queued": the mail is already on its way
      // or delivered, and MailerLite has no edit path for it.
      if (!allowRecreate) {
        throw new Error(
          "This campaign has already gone out, so MailerLite can't edit it. You can send the updated email as a new campaign instead.",
        );
      }
      return recreate();
    }

    if (live.status === "ready") {
      const cancelled = await fetch(
        `${API_BASE}/campaigns/${externalId}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        },
      );
      if (!cancelled.ok) {
        const body = await cancelled.text().catch(() => "");
        // Thrown, not returned: nothing has changed yet, so failing here
        // leaves the existing schedule intact and safe to retry.
        throw new Error(
          `MailerLite couldn't unschedule this campaign to edit it (${cancelled.status}): ${body.slice(0, 400)}`,
        );
      }
    }

    const res = await fetch(`${API_BASE}/campaigns/${externalId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        campaignBody(content, ml, `Content Engine ${input.jobId}`),
      ),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logError(
        "publish:mailerlite:update",
        `MailerLite campaign update failed (${res.status}): ${body.slice(0, 400)}`,
        { campaignId: externalId, status: live.status },
      );
      // A cancelled-then-failed update leaves the campaign sitting as a draft
      // in MailerLite rather than scheduled. Say so, because the previously
      // scheduled send is genuinely no longer going to happen.
      throw new Error(
        `MailerLite campaign update failed (${res.status}): ${body.slice(0, 400)}${
          live.status === "ready"
            ? " The campaign is now unscheduled in MailerLite, so nothing will send until you retry."
            : ""
        }`,
      );
    }

    return deliverCampaign(externalId, input.schedule, apiKey, ml.groupIds);
  },

  async scheduleExisting(input: ScheduleExistingInput): Promise<PublishResult> {
    const ml = resolveMailerliteConfig(input.brand, input.integration);
    if (!ml.apiKey) {
      throw new Error(
        "MailerLite is not connected. Add an API key in Settings → Connections.",
      );
    }
    if (!ml.groupIds?.length) {
      // Same guard as publish(): without it this fails with an opaque
      // provider error indistinguishable from a genuinely gone campaign.
      throw new Error(
        "MailerLite has no audience group selected. Add a group ID in Settings → Connections.",
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

  async registerWebhooks(input) {
    const ml = resolveMailerliteConfig(input.brand, input.integration);
    if (!ml.apiKey) {
      throw new Error("MailerLite is not connected.");
    }

    // Replace rather than accumulate: saving the connection twice must not
    // leave two live subscriptions posting duplicate events at us.
    const previous = readWebhookIds(input.integration);
    if (previous.length) {
      await deleteWebhooks(ml.apiKey, previous);
    }

    // One subscription per event: MailerLite's `batchable` flag is per-webhook
    // and is REQUIRED true for campaign.open/campaign.click, so they can't
    // share a registration with campaign.sent, which is not batchable.
    const created: { id: string; secret: string }[] = [];
    for (const [events, batchable] of WEBHOOK_SUBSCRIPTIONS) {
      const res = await fetch(`${API_BASE}/webhooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ml.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: `Content Engine (${events.join(", ")})`,
          events,
          url: input.callbackUrl,
          enabled: true,
          ...(batchable ? { batchable: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Roll back what we just created so a partial failure doesn't leave
        // orphan subscriptions MailerLite would keep POSTing from.
        if (created.length) {
          await deleteWebhooks(
            ml.apiKey,
            created.map((c) => c.id),
          ).catch(() => {});
        }
        throw new Error(
          `MailerLite webhook registration failed (${res.status}): ${body.slice(0, 400)}`,
        );
      }
      const data = (await res.json()) as {
        data?: { id?: string | number; secret?: string };
      };
      if (data.data?.id == null || !data.data.secret) {
        throw new Error("MailerLite webhook response had no id or secret.");
      }
      created.push({ id: String(data.data.id), secret: data.data.secret });
    }

    // Every subscription gets its own secret; deliveries are verified against
    // any of them (see lib/webhooks/mailerlite.ts), so keep them all.
    return {
      webhookIds: created.map((c) => c.id),
      signingSecret: created.map((c) => c.secret).join(","),
    };
  },

  async removeWebhooks({ brand, integration, webhookIds }) {
    const ml = resolveMailerliteConfig(brand, integration);
    if (!ml.apiKey || !webhookIds.length) return;
    await deleteWebhooks(ml.apiKey, webhookIds);
  },
};

// Which events we subscribe to, and whether that subscription must be
// batchable. Verified against developers.mailerlite.com/docs/webhooks.html:
//   POST /api/webhooks { name, events, url, enabled, batchable }
//     → { data: { id, secret, ... } }   ← `secret` signs every delivery
//   DELETE /api/webhooks/{id}
//   Deliveries carry a `Signature` header: HMAC-SHA256 of the raw body.
// `batchable: true` is REQUIRED for campaign.open and campaign.click.
const WEBHOOK_SUBSCRIPTIONS: [events: string[], batchable: boolean][] = [
  [["campaign.sent"], false],
  [["campaign.open", "campaign.click"], true],
];

/** MailerLite webhook ids previously stored on the connection. */
export function readWebhookIds(integration: BrandIntegration | null): string[] {
  const raw = integration?.config?.webhookIds;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** Best-effort teardown: a already-deleted (404) subscription is not an error. */
async function deleteWebhooks(apiKey: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const res = await fetch(`${API_BASE}/webhooks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (!res.ok && res.status !== 404) {
        logError(
          "mailerlite:removeWebhooks",
          new Error(`Delete webhook ${id} failed (${res.status})`),
        );
      }
    } catch (err) {
      logError("mailerlite:removeWebhooks", err);
    }
  }
}
