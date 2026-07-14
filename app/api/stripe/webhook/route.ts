import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { grantCredits } from "@/lib/billing/credits";
import {
  getStripe,
  getStripeWebhookSecret,
  isStripeConfigured,
  isStripeWebhookConfigured,
} from "@/lib/clients/stripe";
import { logError, logInfo, logWarn } from "@/lib/log";

// A webhook handler must be fast and idempotent, never slow.
export const maxDuration = 30;

/**
 * Stripe webhook receiver. No session auth (Stripe calls this directly, not a
 * logged-in browser); the signature check IS the auth. Reads the RAW body
 * (Next.js App Router doesn't body-parse unless you ask), verifies it against
 * STRIPE_WEBHOOK_SECRET, and only then trusts the event.
 *
 * Slice 4 scope: pack purchases only (checkout.session.completed, mode
 * "payment"). Subscription lifecycle events (customer.subscription.*,
 * invoice.paid, and the subscription-mode branch of checkout.session.completed)
 * are acknowledged with 200 but not yet handled; that lands with the
 * subscriptions slice. Every OTHER unhandled event type is also a no-op 200,
 * which is deliberate: an unhandled event is not a failure, and returning
 * non-2xx for events we don't act on would make Stripe retry them forever.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured() || !isStripeWebhookConfigured()) {
    return NextResponse.json(
      { error: "Stripe webhook isn't configured." },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      raw,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (err) {
    logWarn("stripe:webhook", "Signature verification failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        // Not handled in this slice. 200, not an error: see the file comment.
        break;
    }
  } catch (err) {
    // Non-2xx so Stripe retries (idempotently, for up to ~3 days): the grant
    // is downstream of a real payment, so it must not be silently dropped.
    logError("api:/api/stripe/webhook", err, { type: event.type, id: event.id });
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "payment") {
    // Subscription checkout: provisioning brand_billing.plan_code lands with
    // the subscriptions slice. Not an error, just not our job yet.
    logInfo("stripe:webhook", "Ignoring subscription-mode checkout (not yet handled)", {
      sessionId: session.id,
    });
    return;
  }

  const brandId = session.metadata?.brand_id;
  const credits = Number(session.metadata?.credits);
  const packId = session.metadata?.pack_id;
  if (!brandId || !Number.isFinite(credits) || credits <= 0) {
    // Only our own /api/billing/checkout creates payment-mode sessions for
    // this app, and it always sets this metadata, so this means the session
    // metadata was stripped or tampered with, not a normal case.
    logError(
      "stripe:webhook:checkout-completed",
      new Error("Payment-mode checkout session missing brand/credits metadata"),
      { sessionId: session.id, metadata: session.metadata },
    );
    return;
  }

  await grantCredits({
    brandId,
    credits,
    reason: "pack_purchase",
    sourceId: session.id,
    // One grant per Checkout Session, no matter how many times Stripe
    // retries this webhook delivery.
    idempotencyKey: `pack:${session.id}`,
  });
  logInfo("stripe:webhook", "Granted pack purchase", {
    brandId,
    packId,
    credits,
    sessionId: session.id,
  });
}
