import "server-only";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import { isMissingTableError } from "@/lib/db/table-guard";
import { priceUsage } from "@/lib/pipeline/cost";
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
}

/** Insert failures are swallowed with a plain console.error (never logError/
 * logWarn) to avoid recursing into this same module. */
async function insertLog(row: LogRow): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const db = getAdminClient();
    const { error } = await db.from("app_logs").insert({
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
    });
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

/** Persists one Claude call's token usage as a `usage` row. Console output for
 * usage stays in lib/clients/anthropic.ts's logUsage (which calls this) so
 * there's exactly one console line per call, not two. */
export function logTokenUsage(
  source: string,
  model: string,
  usage: UsageFields,
  opts?: { draftId?: string },
): void {
  const estimated_usd = Number(priceUsage(model, usage).toFixed(4));
  void insertLog({
    level: "usage",
    source,
    message: `${model} call`,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    estimated_usd,
    draft_id: opts?.draftId,
  });
}
