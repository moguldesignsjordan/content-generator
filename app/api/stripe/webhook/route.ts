import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getBillingConfig, grantCredits } from "@/lib/billing/credits";
import {
  getStripe,
  getStripeWebhookSecret,
  isStripeConfigured,
  isStripeWebhookConfigured,
} from "@/lib/clients/stripe";
import { getBrandBillingByCustomerId, upsertBrandBilling } from "@/lib/db/queries";
import { logError, logInfo, logWarn } from "@/lib/log";

// A webhook handler must be fast and idempotent, never slow.
export const maxDuration = 30;

/**
 * Stripe webhook receiver. No session auth (Stripe calls this directly, not a
 * logged-in browser); the signature check IS the auth. Reads the RAW body
 * (Next.js App Router doesn't body-parse unless you ask), verifies it against
 * STRIPE_WEBHOOK_SECRET, and only then trusts the event.
 *
 * Handles pack purchases (checkout.session.completed, mode "payment") and the
 * full subscription lifecycle (checkout.session.completed mode "subscription",
 * customer.subscription.updated/deleted, invoice.paid). Every OTHER event type
 * is a no-op 200, which is deliberate: an unhandled event is not a failure, and
 * returning non-2xx for events we don't act on would make Stripe retry them
 * forever.
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
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        // Not handled: see the file comment.
        break;
    }
  } catch (err) {
    // Non-2xx so Stripe retries (idempotently, for up to ~3 days): a grant or
    // a plan sync is downstream of a real payment event, so it must not be
    // silently dropped.
    logError("api:/api/stripe/webhook", err, { type: event.type, id: event.id });
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode === "subscription") {
    await handleSubscriptionCheckoutCompleted(session);
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

/**
 * Subscription checkout completed. Retrieves the subscription (the session
 * itself doesn't carry status/period) and upserts brand_billing so the plan
 * flips to pro immediately instead of waiting on the customer.subscription.*
 * events Stripe fires right after. upsertBrandBilling is a plain last-write
 * upsert, not a ledger grant, so replaying this handler is naturally safe: it
 * just re-writes the same mirrored state.
 */
async function handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const brandId = session.metadata?.brand_id;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!brandId || !subscriptionId) {
    logError(
      "stripe:webhook:checkout-completed",
      new Error("Subscription checkout session missing brand_id or subscription id"),
      { sessionId: session.id, metadata: session.metadata },
    );
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  await upsertBrandBilling(brandId, {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan_code: "pro",
    status: subscription.status,
    current_period_end: subscriptionPeriodEnd(subscription),
  });
  logInfo("stripe:webhook", "Subscription checkout completed, brand upgraded to pro", {
    brandId,
    subscriptionId: subscription.id,
  });
}

/**
 * Mid-lifecycle subscription changes (renewal, payment-method-driven status
 * change, plan change). Looked up by Stripe Customer id since that's all
 * these events carry, not our brand id.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const billing = await getBrandBillingByCustomerId(customerId);
  if (!billing) {
    logWarn("stripe:webhook:subscription-updated", "No brand for this Stripe customer", {
      customerId,
      subscriptionId: subscription.id,
    });
    return;
  }

  const isLive = subscription.status === "active" || subscription.status === "trialing";
  await upsertBrandBilling(billing.brand_id, {
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: subscriptionPeriodEnd(subscription),
    // Only ever promotes to pro here; a lapsed/past_due status doesn't demote
    // mid-cycle (Stripe's own dunning owns that), full cancellation does via
    // customer.subscription.deleted below.
    plan_code: isLive ? "pro" : billing.plan_code,
  });
}

/** Subscription fully canceled (not just past due): the definitive downgrade. */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const billing = await getBrandBillingByCustomerId(customerId);
  if (!billing) {
    logWarn("stripe:webhook:subscription-deleted", "No brand for this Stripe customer", {
      customerId,
      subscriptionId: subscription.id,
    });
    return;
  }

  await upsertBrandBilling(billing.brand_id, {
    status: "canceled",
    plan_code: "free",
  });
  logInfo("stripe:webhook", "Subscription canceled, brand downgraded to free", {
    brandId: billing.brand_id,
    subscriptionId: subscription.id,
  });
}

/**
 * Every paid subscription invoice (the first one and every renewal) grants
 * the pro monthly allowance. Idempotent per invoice id, so this is safe as a
 * belt-and-suspenders early grant alongside the daily allowance cron: whichever
 * fires first wins, the other is a no-op replay.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // In this Stripe API version, the subscription that generated an invoice
  // lives at parent.subscription_details.subscription, not a top-level
  // invoice.subscription field (that field no longer exists on Invoice).
  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionRef) return; // A one-time-payment invoice, not ours to grant.

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const billing = await getBrandBillingByCustomerId(customerId);
  if (!billing) {
    logWarn("stripe:webhook:invoice-paid", "No brand for this Stripe customer", {
      customerId,
      invoiceId: invoice.id,
    });
    return;
  }

  const config = await getBillingConfig();
  await grantCredits({
    brandId: billing.brand_id,
    credits: config.paidMonthlyAllowance,
    reason: "allowance_paid",
    sourceId: invoice.id,
    idempotencyKey: `allowance:${invoice.id}`,
  });
  logInfo("stripe:webhook", "Granted paid monthly allowance from invoice.paid", {
    brandId: billing.brand_id,
    credits: config.paidMonthlyAllowance,
    invoiceId: invoice.id,
  });
}

/** current_period_end lives on the subscription's first item in this Stripe
 *  API version, not on the subscription itself. Null on a schedule-less or
 *  item-less subscription, which shouldn't happen for a real paid sub. */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}
