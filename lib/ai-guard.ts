import "server-only";
import { getLogStats } from "@/lib/db/queries";
import { logWarn } from "@/lib/log";

// ─────────────────────────────────────────────────────────────────────────────
// Guardrails in front of every AI-spending route: a per-instance sliding-
// window rate limit (protects against runaway loops and accidental
// double-fires) and an optional daily USD budget read from the same app_logs
// usage rows the /logs page shows (protects the wallet). Both degrade OPEN:
// a DB hiccup never blocks legitimate work, it just skips the check.
//
// The budget is set with DAILY_SPEND_LIMIT_USD in .env.local / Vercel env.
// Unset or 0 means no cap. The rate limiter is per serverless instance, so
// treat it as a soft brake, not a security boundary; the budget check is
// DB-backed and therefore global across instances.
// ─────────────────────────────────────────────────────────────────────────────

const windows = new Map<string, number[]>();

export interface GuardResult {
  ok: boolean;
  /** Readable reason, safe to return to the UI, when ok is false. */
  error?: string;
  /** HTTP status to pair with the error (429). */
  status?: number;
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

/** The one-call guard for AI routes: rate limit first (cheap), then budget. */
export async function guardAiRoute(
  operation: string,
  opts?: { limit?: number; windowMs?: number },
): Promise<GuardResult> {
  const limited = checkRateLimit(
    operation,
    opts?.limit ?? 10,
    opts?.windowMs ?? 60_000,
  );
  if (!limited.ok) return limited;
  return checkDailyBudget();
}
