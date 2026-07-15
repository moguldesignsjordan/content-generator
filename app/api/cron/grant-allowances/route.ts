import { NextRequest, NextResponse } from "next/server";
import { currentPeriod, getBillingConfig, grantCredits } from "@/lib/billing/credits";
import { listBrandsForAllowance, markAllowanceGranted } from "@/lib/db/queries";
import { logError } from "@/lib/log";

// No AI calls here, just DB reads/writes across brands; comfortable well under
// the default serverless timeout even at real scale.
export const maxDuration = 60;

/**
 * Vercel Cron's daily tick (see vercel.json). Grants the monthly credit
 * allowance (free or pro, by plan_code) to every brand whose
 * credits_balance.last_allowance_period isn't the current month yet. Fails
 * closed: 503 if CRON_SECRET isn't configured, 401 if the header is missing
 * or wrong, matching /api/cron/run-schedules.
 *
 * Idempotent two ways: the grant itself is keyed `allowance:{brandId}:{period}`
 * (a second same-day run grants nothing even if the stamp write below somehow
 * didn't land), and invoice.paid (stripe webhook) is a belt-and-suspenders
 * early grant for pro brands that already got their allowance the instant
 * their invoice paid, so this cron just no-ops for them until next month.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const period = currentPeriod();
  const [brands, config] = await Promise.all([listBrandsForAllowance(), getBillingConfig()]);

  let granted = 0;
  let skipped = 0;
  let failed = 0;

  for (const brand of brands) {
    if (brand.lastAllowancePeriod === period) {
      skipped++;
      continue;
    }
    try {
      const credits =
        brand.planCode === "pro" ? config.paidMonthlyAllowance : config.freeMonthlyAllowance;
      const reason = brand.planCode === "pro" ? "allowance_paid" : "allowance_free";
      await grantCredits({
        brandId: brand.brandId,
        credits,
        reason,
        sourceId: period,
        idempotencyKey: `allowance:${brand.brandId}:${period}`,
      });
      await markAllowanceGranted(brand.brandId, period);
      granted++;
    } catch (err) {
      failed++;
      logError("api:/api/cron/grant-allowances", err, { brandId: brand.brandId, period });
    }
  }

  return NextResponse.json({ processed: brands.length, granted, skipped, failed, period });
}

export const GET = handle;
export const POST = handle;
