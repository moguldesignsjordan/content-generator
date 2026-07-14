import "server-only";
import { debitForUsage } from "@/lib/billing/credits";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import { isMissingColumnError, isMissingTableError } from "@/lib/db/table-guard";
import { IMAGE_COST_USD, priceUsage } from "@/lib/pipeline/cost";
import type { AppLogLevel } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────────────────────
// Centralized app logging: every error/warning/info line and every Claude
// token-usage event funnels through here, additively (console output is kept
// exactly as before), and persists to app_logs (migration 011) so the /logs
// page can show a live feed. Never throws and never awaits its own DB write —
// a broken logging insert must never break the feature that triggered it.
// Degrades to console-only if Supabase isn't configured or migration 011
// hasn't been applied yet, matching the generation_runs degrade convention.
// ─────────────────────────────────────────────────────────────────────────────

interface UsageFields {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

interface LogRow {
  level: AppLogLevel;
  source: string;
  message: string;
  context?: Record<string, unknown>;
  model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  estimated_usd?: number;
  draft_id?: string;
  brand_id?: string;
}

/** Insert failures are swallowed with a plain console.error (never logError/
 * logWarn) to avoid recursing into this same module. */
async function insertLog(row: LogRow): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const db = getAdminClient();
    const payload = {
      level: row.level,
      source: row.source,
      message: row.message,
      context: row.context ?? {},
      model: row.model ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      cache_creation_input_tokens: row.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: row.cache_read_input_tokens ?? null,
      estimated_usd: row.estimated_usd ?? null,
      draft_id: row.draft_id ?? null,
      brand_id: row.brand_id ?? null,
    };
    const { error } = await db.from("app_logs").insert(payload);
    if (error && isMissingColumnError(error)) {
      // Migration 018 (app_logs.brand_id) isn't applied yet. Keep the log rather
      // than lose it: retry without the new column, exactly as the app behaved
      // before. Attribution is missing, the audit trail is not.
      const { brand_id: _brandId, ...legacy } = payload;
      const { error: retryErr } = await db.from("app_logs").insert(legacy);
      if (retryErr && !isMissingTableError(retryErr)) {
        console.error("[log] failed to persist app_logs row:", retryErr);
      }
      return;
    }
    if (error && !isMissingTableError(error)) {
      console.error("[log] failed to persist app_logs row:", error);
    }
  } catch (err) {
    console.error("[log] failed to persist app_logs row:", err);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Logs + persists an error. `context` should stay small (route path, draft/
 * topic id, short reason) — it's jsonb rendered directly on an in-app page,
 * not a place to dump full request bodies or raw API responses. */
export function logError(
  source: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(`[${source}]`, err);
  void insertLog({
    level: "error",
    source,
    message: errorMessage(err),
    context: {
      ...context,
      ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
    },
  });
}

export function logWarn(
  source: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  console.warn(`[${source}] ${message}`);
  void insertLog({ level: "warn", source, message, context });
}

export function logInfo(
  source: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  console.log(`[${source}] ${message}`);
  void insertLog({ level: "info", source, message, context });
}

/**
 * Options every metered/logged AI call can carry.
 *
 * `brandId` is who to attribute the spend to; `metered` is whether they pay for
 * it. The two are separate on purpose: we attribute EVERYTHING to a brand (so
 * the usage feed and margin reporting are complete), but only charge for the
 * calls that produce customer value (generations and AI edits). Chat turns,
 * settings suggestions and extractions are logged and free.
 *
 * `requestId` should be the provider's own call id (an Anthropic `response.id`)
 * when there is one: it becomes the debit's idempotency key, so the same call
 * can never be charged twice.
 */
export interface UsageOpts {
  draftId?: string;
  brandId?: string;
  metered?: boolean;
  requestId?: string;
}

/** Charges the call when it's metered and we know whose it is. Fire-and-forget:
 * the pre-call credit check is the gate, this is the record. */
function meter(
  source: string,
  realUsd: number,
  opts: UsageOpts | undefined,
): void {
  if (!opts?.metered || !opts.brandId) return;
  void debitForUsage({
    brandId: opts.brandId,
    realUsd,
    source,
    draftId: opts.draftId,
    requestId: opts.requestId,
  });
}

/** Persists one Claude call's token usage as a `usage` row, and debits credits
 * when the call is metered. Console output for usage stays in
 * lib/clients/anthropic.ts's logUsage (which calls this) so there's exactly one
 * console line per call, not two. */
export function logTokenUsage(
  source: string,
  model: string,
  usage: UsageFields,
  opts?: UsageOpts,
): void {
  const realUsd = priceUsage(model, usage);
  void insertLog({
    level: "usage",
    source,
    message: `${model} call`,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    estimated_usd: Number(realUsd.toFixed(4)),
    draft_id: opts?.draftId,
    brand_id: opts?.brandId,
  });
  meter(source, realUsd, opts);
}

/**
 * Persists an IMAGE render as a `usage` row (zero tokens, a flat per-render
 * cost) and debits it when metered.
 *
 * This closes a real hole: image renders pushed their cost into the draft's own
 * usage rollup but never reached app_logs, so every Gemini render was invisible
 * to both the /logs feed and the daily budget guard. Expect a one-step jump in
 * observed spend now that they're counted, that's the previously-unmetered cost
 * surfacing, not a regression.
 */
export function logImageUsage(
  source: string,
  model: string,
  count = 1,
  opts?: UsageOpts,
): void {
  const realUsd = count * IMAGE_COST_USD;
  console.log(`[usage:${source}] images=${count} (~$${realUsd.toFixed(3)})`);
  void insertLog({
    level: "usage",
    source,
    message: `${model} image render${count === 1 ? "" : ` x${count}`}`,
    model,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    estimated_usd: Number(realUsd.toFixed(4)),
    draft_id: opts?.draftId,
    brand_id: opts?.brandId,
  });
  meter(source, realUsd, opts);
}
