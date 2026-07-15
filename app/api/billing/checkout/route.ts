import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { findPack, getBillingConfig } from "@/lib/billing/credits";
import { getStripe, isStripeConfigured } from "@/lib/clients/stripe";
import { getBrandBilling, getBrandForUser, upsertBrandBilling } from "@/lib/db/queries";
import type { Brand, BrandBilling } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Stripe Checkout is a redirect flow; this call itself is fast, no thinking.
export const maxDuration = 30;

/**
 * POST { packId } for a one-time credit pack (mode "payment"), or
 * { plan: "pro" } to subscribe to the monthly plan (mode "subscription").
 * Either way this only creates a Checkout Session and returns its redirect
 * url; it doesn't grant credits or flip plan_code itself, the webhook does
 * that once Stripe confirms the payment/subscription, so a customer closing
 * the tab before paying can't get free credits or a free upgrade.
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

  const body = (await req.json().catch(() => ({}))) as {
    packId?: string;
    plan?: "pro";
  };
  if (!body.packId && body.plan !== "pro") {
    return NextResponse.json(
      { error: "packId or plan is required." },
      { status: 400 },
    );
  }

  try {
    const brand = await getBrandForUser(sessionUser.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const stripe = getStripe();
    const billing = await getBrandBilling(brand.id);
    const customerId = await resolveStripeCustomer(stripe, brand, sessionUser, billing);
    const origin = new URL(req.url).origin;

    if (body.plan === "pro") {
      const priceId = process.env.STRIPE_PRO_PRICE_ID;
      if (!priceId) {
        return NextResponse.json(
          { error: "The Pro plan isn't configured yet. Set STRIPE_PRO_PRICE_ID." },
          { status: 503 },
        );
      }
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=cancelled`,
        // The webhook trusts brand_id here, same reasoning as the pack branch
        // below: it's the one field Stripe can't drop or corrupt on us.
        metadata: { brand_id: brand.id },
      });
      if (!checkoutSession.url) throw new Error("Stripe returned no checkout url.");
      return NextResponse.json({ url: checkoutSession.url });
    }

    const config = await getBillingConfig();
    const pack = findPack(config, body.packId!);
    if (!pack) {
      return NextResponse.json(
        { error: "That credit pack isn't available." },
        { status: 400 },
      );
    }

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
    logError("api:/api/billing/checkout", err, { packId: body.packId, plan: body.plan });
    return NextResponse.json(
      { error: "Couldn't start checkout. Try again." },
      { status: 500 },
    );
  }
}

/**
 * Reuses the brand's existing Stripe Customer (from an earlier pack purchase
 * or subscription) if there is one; otherwise creates one now and persists it
 * immediately, so a second checkout before the webhook lands still reuses the
 * same customer instead of creating a duplicate. Shared by both the pack and
 * subscription branches above.
 */
async function resolveStripeCustomer(
  stripe: Stripe,
  brand: Brand,
  sessionUser: User,
  billing: BrandBilling | null,
): Promise<string> {
  if (billing?.stripe_customer_id) return billing.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: sessionUser.email,
    name: brand.name,
    metadata: { brand_id: brand.id },
  });
  await upsertBrandBilling(brand.id, {
    stripe_customer_id: customer.id,
    plan_code: billing?.plan_code ?? "free",
  });
  return customer.id;
}
