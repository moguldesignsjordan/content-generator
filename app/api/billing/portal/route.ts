import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/clients/stripe";
import { getBrandBilling, getBrandForUser } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 30;

/**
 * POST: creates a Stripe Customer Portal session so the brand can manage
 * their subscription, payment method, and invoice history without a
 * bespoke settings UI. Requires an existing Stripe Customer, which only
 * exists once a brand has bought a pack or subscribed at least once.
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

  try {
    const brand = await getBrandForUser(sessionUser.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const billing = await getBrandBilling(brand.id);
    if (!billing?.stripe_customer_id) {
      return NextResponse.json(
        { error: "Buy credits or subscribe first to open billing management." },
        { status: 400 },
      );
    }

    const origin = new URL(req.url).origin;
    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${origin}/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    logError("api:/api/billing/portal", err);
    return NextResponse.json(
      { error: "Couldn't open billing management. Try again." },
      { status: 500 },
    );
  }
}
