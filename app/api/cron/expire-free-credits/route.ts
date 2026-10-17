import { NextRequest, NextResponse } from "next/server";
import { expireFreeCredits } from "@/lib/billing/credits";
import { logError } from "@/lib/log";

// No AI calls here, just DB reads/writes across brands; comfortable well under
// the default serverless timeout even at real scale.
export const maxDuration = 60;

/**
 * Vercel Cron's daily tick (see vercel.json). Expires the unspent free credits
 * of every brand past billing_config.free_credit_days (see migration 032).
 * Free brands get no monthly top-up; Pro allowances come from the Stripe
 * webhook's invoice.paid. Fails closed: 503 if CRON_SECRET isn't configured,
 * 401 if the header is missing or wrong, matching /api/cron/run-schedules.
 *
 * Idempotent: each expiry is keyed `expiry:{brandId}`, so a double-fire
 * expires nothing twice.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expired = await expireFreeCredits();
    return NextResponse.json({ expired });
  } catch (err) {
    logError("api:/api/cron/expire-free-credits", err);
    return NextResponse.json({ error: "Expiry failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
