import "server-only";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import {
  detectProviderOutage,
  outageMessage,
  type AiProvider,
  type ProviderOutage,
} from "@/lib/provider-errors";

// ─────────────────────────────────────────────────────────────────────────────
// What happens when a provider account breaks: the client gets a neutral
// message (publicError) and Jordan gets one email per provider per hour
// (reportProviderOutage), sent through Resend's REST API (no SDK).
//
// Imports nothing from lib/log.ts: logError calls INTO this module, so a
// back-import would be circular. Failures here go to console directly, and
// never throw: a broken alert must not break the request that hit it.
// ─────────────────────────────────────────────────────────────────────────────

const ALERT_SOURCE = "alert:provider-outage";
const THROTTLE_MS = 60 * 60 * 1000;

const BILLING_PAGES: Record<AiProvider, string> = {
  anthropic: "https://platform.claude.com",
  gemini: "https://aistudio.google.com",
  openai: "https://platform.openai.com",
};

const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  gemini: "Gemini",
  openai: "OpenAI",
};

// Per-instance memory collapses a burst (every queued render failing at once)
// before it reaches the DB check, which is what dedupes across instances.
const lastAlertAt = new Map<string, number>();

/**
 * For a route's catch block: the message and status to send the client. A
 * provider outage gets a neutral message and a 503, and alerts Jordan; any
 * other error keeps the route's existing behavior (its own message, or the
 * fallback), so validation messages like "Try rephrasing the subject" survive.
 */
export function publicError(err: unknown, fallback: string): { message: string; status: number } {
  const outage = detectProviderOutage(err);
  if (outage) {
    void reportProviderOutage(outage);
    return { message: outageMessage(outage), status: 503 };
  }
  return { message: err instanceof Error ? err.message : fallback, status: 500 };
}

/** Records the outage in app_logs (so /logs shows it) and emails Jordan, at
 *  most once per provider and kind per hour. */
export async function reportProviderOutage(
  outage: ProviderOutage,
  source?: string,
): Promise<void> {
  const key = `${outage.provider}:${outage.kind}`;
  const now = Date.now();
  const last = lastAlertAt.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return;
  lastAlertAt.set(key, now);

  try {
    if (await alertedRecently(key, now)) return;
    await recordAlert(key, outage, source);
    await sendAlertEmail(outage, source);
  } catch (err) {
    console.error("[provider-outage] alert failed:", err);
  }
}

async function alertedRecently(key: string, now: number): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const { data, error } = await getAdminClient()
    .from("app_logs")
    .select("id")
    .eq("source", ALERT_SOURCE)
    .eq("context->>key", key)
    .gte("created_at", new Date(now - THROTTLE_MS).toISOString())
    .limit(1);
  // Can't tell, so alert: a duplicate email beats a missed outage.
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

async function recordAlert(key: string, outage: ProviderOutage, source?: string): Promise<void> {
  console.error(`[${ALERT_SOURCE}] ${outage.provider} ${outage.kind}: ${outage.detail}`);
  if (!isSupabaseConfigured()) return;
  const { error } = await getAdminClient()
    .from("app_logs")
    .insert({
      level: "error",
      source: ALERT_SOURCE,
      message: `${PROVIDER_NAMES[outage.provider]} ${outage.kind} failure: ${outage.detail}`,
      context: { key, provider: outage.provider, kind: outage.kind, status: outage.status, source },
    });
  if (error) console.error("[provider-outage] failed to record alert:", error);
}

async function sendAlertEmail(outage: ProviderOutage, source?: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) {
    console.warn("[provider-outage] RESEND_API_KEY or ALERT_EMAIL is not set; alert logged only.");
    return;
  }

  const name = PROVIDER_NAMES[outage.provider];
  const problem = outage.kind === "billing" ? "billing or credits problem" : "API key problem";
  const text = [
    `${name} is rejecting requests because of a ${problem}. Clients are seeing a "temporarily unavailable" message until it's fixed.`,
    "",
    `Status: ${outage.status ?? "unknown"}`,
    `Provider message: ${outage.detail}`,
    ...(source ? [`First seen in: ${source}`] : []),
    `Time: ${new Date().toISOString()}`,
    "",
    `Fix it here: ${BILLING_PAGES[outage.provider]}`,
    "You'll get at most one of these per hour while it keeps failing.",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL ?? "Mogul alerts <onboarding@resend.dev>",
      to: [to],
      subject: `${name} ${problem}: generation is down`,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("[provider-outage] Resend rejected the alert:", res.status, await res.text().catch(() => ""));
  }
}
