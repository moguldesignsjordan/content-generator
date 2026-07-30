import { NextRequest, NextResponse } from "next/server";
import {
  finishWebhookEvent,
  getBrandById,
  getBrandIdForPublication,
  getBrandIntegrationByWebhookToken,
  getPublicationByExternalId,
  recordWebhookEvent,
  updatePublicationStatus,
} from "@/lib/db/queries";
import { refreshPerformanceForPublication } from "@/lib/pipeline/performance";
import { resolveSecret } from "@/lib/publishing/credentials";
import {
  hashBody,
  parseEvents,
  parseSigningSecrets,
  verifySignature,
  type MailerliteEvent,
} from "@/lib/webhooks/mailerlite";
import { logError, logInfo, logWarn } from "@/lib/log";

// A webhook handler must be fast and idempotent, never slow.
export const maxDuration = 30;

/**
 * MailerLite webhook receiver. No session auth (MailerLite calls this
 * directly, not a logged-in browser) — the `Signature` HMAC check IS the auth,
 * exactly as in app/api/stripe/webhook/route.ts. The `token` path segment only
 * selects WHICH brand's signing secret to verify against, because a signature
 * can't be checked before you know whose secret to use.
 *
 * Replaces the pull-only stats path: rather than waiting for someone to open a
 * draft and hit Refresh, campaign.sent flips the publication to sent and pulls
 * a first snapshot, and batched open/click events trigger a debounced refresh.
 *
 * Every recognized-but-unhandled event is a no-op 200. That is deliberate:
 * returning non-2xx for events we don't act on would make MailerLite retry
 * them forever.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Read the RAW body before anything parses it — the signature covers these
  // exact bytes, and JSON.stringify(JSON.parse(x)) is not byte-identical.
  const raw = await req.text();

  const integration = await getBrandIntegrationByWebhookToken(
    "mailerlite",
    token,
  ).catch((err) => {
    logError("api:/api/webhooks/mailerlite:lookup", err);
    return null;
  });
  if (!integration) {
    // Unknown token. Same shape as a bad signature: tell it nothing.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let secrets: string[];
  try {
    secrets = parseSigningSecrets(
      resolveSecret(integration, "webhookSecret", "MAILERLITE_WEBHOOK_SECRET"),
    );
  } catch (err) {
    logError("api:/api/webhooks/mailerlite:secret", err);
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  if (!verifySignature(raw, req.headers.get("signature"), secrets)) {
    logWarn("mailerlite:webhook", "Signature verification failed", {
      brandId: integration.brand_id,
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const events = parseEvents(payload);

  // Insert-then-process: a crash mid-handler leaves processed_at null, which
  // is visible and retryable, instead of a side effect nobody can account for.
  const record = await recordWebhookEvent({
    provider: "mailerlite",
    bodyHash: hashBody(raw),
    eventType: events[0]?.type ?? "unknown",
    brandId: integration.brand_id,
    payload,
  }).catch((err) => {
    logError("api:/api/webhooks/mailerlite:record", err);
    return null;
  });

  // Null means this exact body was already recorded (a provider retry) — stop
  // here so the side effects don't run twice.
  if (!record) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handleEvents(events, integration.brand_id);
    await finishWebhookEvent(record.id);
  } catch (err) {
    logError("api:/api/webhooks/mailerlite:handle", err);
    await finishWebhookEvent(
      record.id,
      err instanceof Error ? err.message : String(err),
    );
    // Still 200: the delivery was authentic and is safely persisted, so a
    // retry would only re-hit the dedupe. Failures surface in webhook_events.
  }

  return NextResponse.json({ received: true, events: events.length });
}

/**
 * Acts on one delivery's events. Campaign ids are de-duplicated first: a
 * batched open/click payload carries hundreds of events for the same campaign,
 * and they all resolve to one refresh.
 */
async function handleEvents(
  events: MailerliteEvent[],
  brandId: string,
): Promise<void> {
  const campaigns = new Map<string, { sent: boolean }>();
  for (const e of events) {
    if (!e.campaignId) continue;
    const entry = campaigns.get(e.campaignId) ?? { sent: false };
    if (e.type === "campaign.sent") entry.sent = true;
    campaigns.set(e.campaignId, entry);
  }
  if (!campaigns.size) return;

  const brand = await getBrandById(brandId);
  if (!brand) return;

  for (const [campaignId, { sent }] of campaigns) {
    const publication = await getPublicationByExternalId(
      "mailerlite",
      campaignId,
    );
    if (!publication) continue;

    // Tenant check: the token told us which brand is calling, so a leaked
    // token still can't touch another brand's publications.
    const owner = await getBrandIdForPublication(publication.id);
    if (owner !== brandId) {
      logWarn("mailerlite:webhook", "Campaign does not belong to this brand", {
        brandId,
        campaignId,
      });
      continue;
    }

    if (sent && publication.status !== "sent") {
      await updatePublicationStatus(publication.id, "sent");
    }

    // campaign.sent is the one moment worth a guaranteed fetch (first real
    // numbers, and it fires once). Open/click batches take the debounce.
    const fetched = await refreshPerformanceForPublication(publication, brand, {
      force: sent,
    }).catch((err) => {
      logError("mailerlite:webhook:stats", err);
      return false;
    });

    if (fetched) {
      logInfo("mailerlite:webhook", "Refreshed campaign stats", {
        brandId,
        campaignId,
      });
    }
  }
}
