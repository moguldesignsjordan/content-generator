import { NextResponse } from "next/server";
import { getBalance, getBillingConfig } from "@/lib/billing/credits";
import type { BillingSummary } from "@/lib/billing/buy-credits";
import { isStripeConfigured } from "@/lib/clients/stripe";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandBilling, getBrandForUser } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: the signed-in brand's balance and what it can buy, for the
 *  buy-credits popup. Same reads as the /billing page. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });
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
    const [balance, config, billing] = await Promise.all([
      getBalance(brand.id),
      getBillingConfig(),
      getBrandBilling(brand.id),
    ]);
    const summary: BillingSummary = {
      balance,
      // Stripe price ids stay server-side; checkout looks the pack up by id.
      packs: config.packs.map(({ id, credits, price_usd }) => ({ id, credits, price_usd })),
      planCode: billing?.plan_code ?? "free",
      stripeConfigured: isStripeConfigured(),
      proPlanConfigured: Boolean(process.env.STRIPE_PRO_PRICE_ID),
    };
    return NextResponse.json(summary);
  } catch (err) {
    logError("api:/api/billing/summary", err);
    return NextResponse.json({ error: "Couldn't load your balance." }, { status: 500 });
  }
}
