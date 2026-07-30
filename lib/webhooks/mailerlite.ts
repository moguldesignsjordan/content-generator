import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Verification and payload parsing for inbound MailerLite webhooks. Pure
// functions over strings: no DB, no network, so the security-critical part is
// fully unit-testable. The side effects live in the route handler.
//
// Shapes verified against developers.mailerlite.com/docs/webhooks.html:
//   Header:  `Signature` = HMAC-SHA256 (hex) of the RAW request body.
//   Single event, campaign.sent:
//     { id, name, total_recipients, preview_url, date, event, account_id }
//   Single event, campaign.open / campaign.click:
//     { type, subscriber, campaign, link_url?, account_id }
//   Batched (required for campaign.open/click):
//     { events: [ ...one of the above per entry... ], total }
// There is NO per-delivery id anywhere in the payload, which is why the
// idempotency key is a hash of the body rather than a provider-supplied id.

/** The idempotency key for a delivery: sha256 of the exact bytes received. */
export function hashBody(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time check of the `Signature` header against every secret this
 * connection knows. Plural because we register more than one subscription
 * (campaign.sent can't be batchable, campaign.open/click must be) and
 * MailerLite issues a separate secret per subscription — a delivery is
 * authentic if ANY of them signs it.
 *
 * Returns false rather than throwing on malformed input: an unverifiable
 * request is simply rejected, never a 500.
 */
export function verifySignature(
  raw: string,
  signature: string | null,
  secrets: string[],
): boolean {
  if (!signature || !secrets.length) return false;
  const provided = Buffer.from(signature.trim(), "utf8");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(
      createHmac("sha256", secret).update(raw, "utf8").digest("hex"),
      "utf8",
    );
    // timingSafeEqual throws on length mismatch; a wrong-length signature is
    // already a mismatch, and comparing lengths first leaks nothing secret.
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  });
}

/** Splits the stored (decrypted) secret blob back into individual secrets. */
export function parseSigningSecrets(stored: string | undefined): string[] {
  if (!stored) return [];
  return stored
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One delivery, flattened to what the handler actually acts on. */
export interface MailerliteEvent {
  /** e.g. "campaign.sent", "campaign.open", "campaign.click". */
  type: string;
  /** The MailerLite campaign id, when the event is about a campaign. */
  campaignId?: string;
}

/**
 * Flattens a delivery into zero or more events. Batched payloads unwrap;
 * single payloads yield one. Anything unrecognized yields nothing, which the
 * handler treats as a no-op success (an unhandled event is not a failure, and
 * a non-2xx would make MailerLite retry it forever).
 */
export function parseEvents(payload: unknown): MailerliteEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.events)) {
    return obj.events.flatMap((e) => parseSingleEvent(e));
  }
  return parseSingleEvent(obj);
}

function parseSingleEvent(raw: unknown): MailerliteEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  // Simple events name themselves in `event`; the nested/relational ones
  // (campaign.open, campaign.click, subscriber.added_to_group) use `type`.
  const type =
    typeof obj.event === "string"
      ? obj.event
      : typeof obj.type === "string"
        ? obj.type
        : null;
  if (!type) return [];

  return [{ type, campaignId: extractCampaignId(type, obj) }];
}

function extractCampaignId(
  type: string,
  obj: Record<string, unknown>,
): string | undefined {
  // campaign.sent IS the campaign object: its top-level `id` is the campaign.
  if (type === "campaign.sent") {
    return asId(obj.id);
  }
  // campaign.open / campaign.click nest it, since the top level describes the
  // subscriber's action rather than the campaign.
  const campaign = obj.campaign;
  if (campaign && typeof campaign === "object") {
    return asId((campaign as Record<string, unknown>).id);
  }
  return undefined;
}

function asId(v: unknown): string | undefined {
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}
