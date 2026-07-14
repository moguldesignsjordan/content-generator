import { NextRequest, NextResponse } from "next/server";
import { findPack, getBillingConfig } from "@/lib/billing/credits";
import { getStripe, isStripeConfigured } from "@/lib/clients/stripe";
import { getBrandBilling, getBrandForUser, upsertBrandBilling } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Stripe Checkout is a redirect flow; this call itself is fast, no thinking.
export const maxDuration = 30;

/**
 * POST { packId }: creates a Stripe Checkout Session (mode "payment") for one
 * of the configured credit packs and returns its redirect url. Doesn't grant
 * anything itself, the webhook does that once Stripe confirms payment, so a
 * customer closing the tab before paying can't get free credits.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing isn't set up yet. Set STRIPE_SECRET_KEY in .env.local." },
      { status: 503 },
    );
  }

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { packId } = (await req.json().catch(() => ({}))) as { packId?: string };
  if (!packId) {
    return NextResponse.json({ error: "packId is required." }, { status: 400 });
  }

  try {
    const brand = await getBrandForUser(sessionUser.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const config = await getBillingConfig();
    const pack = findPack(config, packId);
    if (!pack) {
      return NextResponse.json(
        { error: "That credit pack isn't available." },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const billing = await getBrandBilling(brand.id);

    // Reuse the existing Stripe Customer if this brand has one (from an
    // earlier pack purchase or a subscription); otherwise create one now and
    // persist it immediately, so a second purchase before the webhook lands
    // still reuses the same customer instead of creating a duplicate.
    let customerId = billing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: sessionUser.email,
        name: brand.name,
        metadata: { brand_id: brand.id },
      });
      customerId = customer.id;
      await upsertBrandBilling(brand.id, {
        stripe_customer_id: customerId,
        plan_code: billing?.plan_code ?? "free",
      });
    }

    const origin = new URL(req.url).origin;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
      success_url: `${origin}/billing?checkout=success`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
      // The webhook trusts THIS metadata for the grant, not a fresh lookup of
      // pack.credits by id: if the pack's price/credits are retuned in
      // billing_config between checkout and payment, the customer still gets
      // exactly what they were charged for at the moment they paid.
      metadata: {
        brand_id: brand.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
    });

    if (!checkoutSession.url) {
      throw new Error("Stripe returned no checkout url.");
    }
    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    logError("api:/api/billing/checkout", err, { packId });
    return NextResponse.json(
      { error: "Couldn't start checkout. Try again." },
      { status: 500 },
    );
  }
}
