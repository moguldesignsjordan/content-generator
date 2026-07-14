import "server-only";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import { isMissingTableError } from "@/lib/db/table-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Credits: the billing meter.
//
// A credit is a cents-equivalent denomination of the real USD a call cost us.
// The chain is: priceUsage() gives real cost -> markup gives our margin ->
// creditsForUsage() rounds it into whole credits -> debit_credits() records it.
//
// Deliberately imports nothing from lib/log.ts: log.ts calls INTO this module
// (that's the metering chokepoint), so a back-import would be circular. Failures
// here therefore go to console directly, the same way lib/log.ts's own insert
// failures do, and for the same reason: a broken meter must never break the
// feature that triggered it.
//
// Every balance move goes through the two RPCs (migration 019). Nothing in the
// app writes credits_balance directly.
// ─────────────────────────────────────────────────────────────────────────────

export type CreditReason =
  | "starter"
  | "allowance_free"
  | "allowance_paid"
  | "pack_purchase"
  | "usage"
  | "manual_adjustment";

export interface BillingConfig {
  creditsPerUsd: number;
  markupMultiplier: number;
  starterCreditGrant: number;
  freeMonthlyAllowance: number;
  paidMonthlyAllowance: number;
  packs: CreditPack[];
}

export interface CreditPack {
  id: string;
  credits: number;
  price_usd: number;
  stripe_price_id: string;
}

/** Looks up a configured pack by its id, or undefined if it's unknown/removed.
 *  Shared by the checkout route (validate what the client asked to buy) and its
 *  tests; pure so it needs no mocking. */
export function findPack(
  config: Pick<BillingConfig, "packs">,
  packId: string,
): CreditPack | undefined {
  return config.packs.find((p) => p.id === packId);
}

/** Used when billing_config can't be read (migration 019 not applied yet, or a
 *  DB hiccup). Same numbers as the migration's column defaults: the config row
 *  is the tuning knob, not the source of truth for whether billing works. */
export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  creditsPerUsd: 100,
  markupMultiplier: Number(process.env.CREDIT_MARKUP_MULTIPLIER ?? 2.0),
  starterCreditGrant: 2000,
  freeMonthlyAllowance: 1000,
  paidMonthlyAllowance: 10000,
  packs: [],
};

/**
 * Real USD -> whole credits charged.
 *
 * `ceil` + `max(1, ...)` so the business never under-charges: a cache-heavy call
 * that really cost $0.0003 still costs the customer 1 credit rather than
 * rounding to free. Pure, and the one place the pricing formula lives.
 */
export function creditsForUsage(
  realUsd: number,
  config: Pick<BillingConfig, "creditsPerUsd" | "markupMultiplier"> = DEFAULT_BILLING_CONFIG,
): number {
  if (!Number.isFinite(realUsd) || realUsd <= 0) return 1;
  const raw = realUsd * config.markupMultiplier * config.creditsPerUsd;
  // Scrub float noise BEFORE the ceil. 0.05 * 3 * 100 is 15.000000000000002 in
  // IEEE 754, and a naive ceil turns that into 16: the customer pays an extra
  // credit for a rounding artifact. toPrecision(12) is far finer than any real
  // pricing difference and far coarser than the drift.
  const cleaned = Number(raw.toPrecision(12));
  return Math.max(1, Math.ceil(cleaned));
}

/** 'YYYY-MM' — the monthly allowance period key (see credits_balance
 *  .last_allowance_period). UTC so a cron near midnight can't straddle two. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The idempotency key for one metered call. Prefer a stable id from the
 *  provider (an Anthropic message id) so a retried debit collapses onto the same
 *  row; fall back to a uuid when there's none, which still prevents collisions,
 *  it just can't dedupe a genuine replay. */
export function usageIdempotencyKey(requestId?: string): string {
  // The global Web Crypto randomUUID, not node:crypto: this module is reachable
  // from code webpack bundles for the edge runtime, where a node: import fails
  // the build outright.
  return `usage:${requestId ?? crypto.randomUUID()}`;
}

let cachedConfig: BillingConfig | null = null;

/** The tunable economics. Cached per server instance: this is read on every
 *  metered call and changes roughly never (a redeploy or instance recycle picks
 *  up an edit). */
export async function getBillingConfig(): Promise<BillingConfig> {
  if (cachedConfig) return cachedConfig;
  if (!isSupabaseConfigured()) return DEFAULT_BILLING_CONFIG;
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from("billing_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return DEFAULT_BILLING_CONFIG;
    cachedConfig = {
      creditsPerUsd: data.credits_per_usd ?? DEFAULT_BILLING_CONFIG.creditsPerUsd,
      markupMultiplier: Number(
        data.markup_multiplier ?? DEFAULT_BILLING_CONFIG.markupMultiplier,
      ),
      starterCreditGrant:
        data.starter_credit_grant ?? DEFAULT_BILLING_CONFIG.starterCreditGrant,
      freeMonthlyAllowance:
        data.free_monthly_allowance ?? DEFAULT_BILLING_CONFIG.freeMonthlyAllowance,
      paidMonthlyAllowance:
        data.paid_monthly_allowance ?? DEFAULT_BILLING_CONFIG.paidMonthlyAllowance,
      packs: (data.packs as CreditPack[]) ?? [],
    };
    return cachedConfig;
  } catch {
    return DEFAULT_BILLING_CONFIG;
  }
}

/** Test/ops seam: drop the per-instance config cache. */
export function resetBillingConfigCache(): void {
  cachedConfig = null;
}

/** A brand's current credit balance. 0 when they have no ledger row yet. */
export async function getBalance(brandId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const db = getAdminClient();
  const { data, error } = await db
    .from("credits_balance")
    .select("balance")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

/**
 * The synchronous gate in front of a metered call. Degrades OPEN on any DB
 * error, matching checkDailyBudget's contract in lib/ai-guard.ts: a database
 * hiccup must not stop a paying customer from working, and the global
 * DAILY_SPEND_LIMIT_USD is the backstop if this is ever wrong.
 */
export async function hasSufficientCredits(
  brandId: string,
  need = 1,
): Promise<boolean> {
  try {
    return (await getBalance(brandId)) >= need;
  } catch (err) {
    if (!isMissingTableError(err as { code?: string })) {
      console.error("[credits] balance check failed, allowing the call:", err);
    }
    return true;
  }
}

/** Adds credits. Idempotent on `idempotencyKey`: a replayed Stripe webhook or a
 *  double-fired cron grants exactly once. Returns the new balance, or null if
 *  the grant couldn't be recorded. */
export async function grantCredits(args: {
  brandId: string;
  credits: number;
  reason: CreditReason;
  sourceId?: string;
  idempotencyKey: string;
}): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  const db = getAdminClient();
  const { data, error } = await db.rpc("grant_credits", {
    p_brand: args.brandId,
    p_delta: args.credits,
    p_reason: args.reason,
    p_source: args.sourceId ?? null,
    p_idem: args.idempotencyKey,
  });
  if (error) {
    console.error("[credits] grant failed:", error);
    return null;
  }
  return (data as number) ?? null;
}

/** Subtracts credits (magnitude, not signed). Floors at zero, never throws. */
export async function debitCredits(args: {
  brandId: string;
  credits: number;
  reason: CreditReason;
  sourceId?: string;
  idempotencyKey: string;
  usdReference?: number;
}): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  const db = getAdminClient();
  const { data, error } = await db.rpc("debit_credits", {
    p_brand: args.brandId,
    p_delta: args.credits,
    p_reason: args.reason,
    p_source: args.sourceId ?? null,
    p_idem: args.idempotencyKey,
    p_usd: args.usdReference ?? null,
  });
  if (error) {
    console.error("[credits] debit failed:", error);
    return null;
  }
  return (data as number) ?? null;
}

/**
 * Debit one metered call. Called from lib/log.ts's usage chokepoint, so every
 * charged call is charged in exactly one place.
 *
 * Best-effort by design (the caller does not await it): the hard gate is the
 * pre-call hasSufficientCredits. A failure here means one missed debit (we
 * under-bill), never a blocked generation and never a negative balance. That
 * asymmetry is deliberate: the cost of a lost debit is cents, the cost of a
 * broken generation is a customer.
 */
export async function debitForUsage(args: {
  brandId: string;
  realUsd: number;
  source: string;
  draftId?: string;
  requestId?: string;
}): Promise<void> {
  try {
    const config = await getBillingConfig();
    const credits = creditsForUsage(args.realUsd, config);
    await debitCredits({
      brandId: args.brandId,
      credits,
      reason: "usage",
      sourceId: args.draftId ?? args.source,
      idempotencyKey: usageIdempotencyKey(args.requestId),
      usdReference: Number(args.realUsd.toFixed(6)),
    });
  } catch (err) {
    console.error("[credits] usage debit failed:", err);
  }
}

/** The one-time grant a brand gets when it's created. Idempotent per brand, so
 *  re-running onboarding can't mint a second helping. */
export async function grantStarterCredits(brandId: string): Promise<void> {
  const config = await getBillingConfig();
  await grantCredits({
    brandId,
    credits: config.starterCreditGrant,
    reason: "starter",
    sourceId: brandId,
    idempotencyKey: `starter:${brandId}`,
  });
}
