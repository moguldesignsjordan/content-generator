import "server-only";
import { hasSufficientCredits } from "@/lib/billing/credits";
import { getBrandByDraftId, getLogStats } from "@/lib/db/queries";
import { logWarn } from "@/lib/log";

// ─────────────────────────────────────────────────────────────────────────────
// Guardrails in front of every AI-spending route. Three checks, cheapest first:
//
//   1. rate limit   per-instance sliding window; catches runaway loops and
//                   double-fires. Keyed per BRAND, so one customer's burst
//                   can't rate-limit everyone else.
//   2. credits      does this brand have any balance left? The customer-facing
//                   gate: out of credits means buy more (402-ish), not "slow
//                   down". This is the pre-call check that makes the
//                   fire-and-forget debit safe.
//   3. daily budget the HOUSE breaker (DAILY_SPEND_LIMIT_USD): a global cap on
//                   our own spend, independent of what customers have paid for.
//                   Kept as the backstop in case the credit meter is ever wrong.
//
// All three degrade OPEN: a DB hiccup never blocks legitimate work, it just
// skips the check. The asymmetry is deliberate. A missed check costs cents; a
// generation that dies on a transient database error costs a customer.
// ─────────────────────────────────────────────────────────────────────────────

const windows = new Map<string, number[]>();

export interface GuardResult {
  ok: boolean;
  /** Readable reason, safe to return to the UI, when ok is false. */
  error?: string;
  /** HTTP status to pair with the error (429). */
  status?: number;
  /**
   * True when the block is "you have no credits", not "you're going too fast".
   * The UI keys off this to show a Buy-credits CTA instead of a retry hint, so
   * a paying customer is never told to wait for something that will never clear
   * on its own.
   */
  outOfCredits?: boolean;
  /** Where to send them to fix it. Only set alongside outOfCredits. */
  upgradeUrl?: string;
}

/**
 * Sliding-window rate limit. Returns ok:false with a retry hint once `limit`
 * calls have landed inside the window. Keys are per operation ("generate",
 * "image", ...); single-brand today, so no per-user component yet.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): GuardResult {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryMs = windowMs - (now - hits[0]);
    const retrySec = Math.max(1, Math.ceil(retryMs / 1000));
    return {
      ok: false,
      status: 429,
      error: `Slow down a moment: that's ${limit} requests in under a minute. Try again in ~${retrySec}s.`,
    };
  }
  hits.push(now);
  windows.set(key, hits);
  return { ok: true };
}

/**
 * Blocks new AI work once the last 24h of estimated spend (app_logs usage
 * rows) crosses DAILY_SPEND_LIMIT_USD. No-op when the env var is unset/0 or
 * when stats can't be read.
 */
export async function checkDailyBudget(): Promise<GuardResult> {
  const cap = Number(process.env.DAILY_SPEND_LIMIT_USD ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) return { ok: true };
  try {
    const stats = await getLogStats();
    if (stats.estimatedUsd24h >= cap) {
      logWarn("ai-guard:budget", "Daily AI budget reached; blocking new work", {
        cap,
        spent24h: stats.estimatedUsd24h,
      });
      return {
        ok: false,
        status: 429,
        error: `Daily AI budget reached ($${stats.estimatedUsd24h.toFixed(2)} of $${cap.toFixed(2)} in the last 24h). Raise DAILY_SPEND_LIMIT_USD or try again later.`,
      };
    }
  } catch {
    // Degrade open: budget enforcement is a convenience, not a lock.
  }
  return { ok: true };
}

/**
 * Blocks a metered call when the brand's credit balance is empty.
 *
 * This is the real paywall. It runs BEFORE the AI call, which is what lets the
 * post-call debit be fire-and-forget: the worst a lost debit can do is
 * under-bill by one call, because the next call's pre-check sees the balance.
 *
 * Degrades open on any DB error (same contract as checkDailyBudget), with
 * DAILY_SPEND_LIMIT_USD as the backstop.
 */
export async function checkCredits(brandId: string): Promise<GuardResult> {
  const enough = await hasSufficientCredits(brandId, 1);
  if (enough) return { ok: true };
  logWarn("ai-guard:credits", "Brand is out of credits; blocking new work", {
    brandId,
  });
  return {
    ok: false,
    status: 429,
    outOfCredits: true,
    upgradeUrl: "/billing",
    error: "You're out of credits. Top up to keep generating.",
  };
}

/**
 * The one-call guard for AI routes: rate limit (cheap, in-memory), then the
 * brand's credits, then the house budget.
 *
 * `brandId` is optional only so that not-yet-migrated callers still compile;
 * without it the credit check is skipped, which means an unattributed route
 * spends for free. Pass it everywhere that spends.
 */
export async function guardAiRoute(
  operation: string,
  opts?: { brandId?: string; limit?: number; windowMs?: number },
): Promise<GuardResult> {
  // Key the window per brand: one customer hammering Generate must not
  // rate-limit every other customer on the same serverless instance.
  const key = opts?.brandId ? `${operation}:${opts.brandId}` : operation;
  const limited = checkRateLimit(
    key,
    opts?.limit ?? 10,
    opts?.windowMs ?? 60_000,
  );
  if (!limited.ok) return limited;

  if (opts?.brandId) {
    const credits = await checkCredits(opts.brandId);
    if (!credits.ok) return credits;
  }

  return checkDailyBudget();
}

/**
 * guardAiRoute for the draft-scoped edit routes (redesign, adjust-style,
 * rewrite-region, reject/regenerate), which know a draft id but not a brand.
 * Resolves the owning brand through draft -> job -> brand so those routes get
 * the same per-brand rate limit and credit gate as the generation routes.
 *
 * A draft whose brand can't be resolved degrades open: it's an orphaned row, not
 * a paying customer trying to sneak a free call.
 */
export async function guardDraftAiRoute(
  operation: string,
  draftId: string,
  opts?: { limit?: number; windowMs?: number },
): Promise<GuardResult> {
  let brandId: string | undefined;
  try {
    brandId = (await getBrandByDraftId(draftId))?.id;
  } catch {
    // Degrade open, same contract as every other check here.
  }
  return guardAiRoute(operation, { ...opts, brandId });
}
