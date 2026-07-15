import "server-only";
import { logPrompt } from "@/lib/log";

// ─────────────────────────────────────────────────────────────────────────────
// Prompt capture (migration 021).
//
// Every prompt this app sends to Anthropic is captured at the fetch layer —
// one hook (see lib/clients/anthropic.ts capturingFetch) instead of edits at
// all ~19 getAnthropic() call sites, and it can never drift when a new call
// site is added. The request body is sanitized (base64 payloads stripped)
// and persisted to prompt_logs for the /prompts admin page. Capture is
// fire-and-forget and failure-proof: a broken capture must never break or
// slow the API call it observed.
// ─────────────────────────────────────────────────────────────────────────────

/** Long, spaceless base64-looking strings (embedded images / documents) are
 * replaced with a size placeholder; actual prompt text is never truncated —
 * reading it in full is the entire point of the capture. */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 4096 && /^[A-Za-z0-9+/=\-_]+$/.test(value)) {
      return `[${Math.round(value.length / 1024)} KB base64 omitted]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v);
    return out;
  }
  return value;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block as { text?: unknown })?.text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return "";
}

/** First non-empty line of the system prompt — in practice each flow's system
 * prompt opens with a distinct sentence, so this doubles as the call's label
 * in the /prompts list. Falls back to the first user message (chat routes
 * without a system prompt). */
export function previewOf(body: Record<string, unknown>): string {
  const system = textOf(body.system);
  const source =
    system ||
    textOf((body.messages as { content?: unknown }[] | undefined)?.[0]?.content);
  return source.split("\n").find((l) => l.trim()) ?? "";
}

/** The SDK re-invokes fetch on 429/5xx retries with an identical body; only
 * the first attempt should be captured. A tiny fingerprint→timestamp map is
 * enough — bodies differ across genuine calls (topic text, timestamps). */
const recentCaptures = new Map<string, number>();
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export function alreadyCaptured(body: string, now = Date.now()): boolean {
  const key = `${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;
  const seen = recentCaptures.get(key);
  recentCaptures.set(key, now);
  if (recentCaptures.size > 100) {
    for (const [k, ts] of recentCaptures) {
      if (now - ts > DEDUPE_WINDOW_MS) recentCaptures.delete(k);
    }
  }
  return seen !== undefined && now - seen < DEDUPE_WINDOW_MS;
}

export function capturePrompt(
  input: string | URL | Request,
  init?: RequestInit,
): void {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return;
  if (typeof init?.body !== "string") return;
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url).pathname;
  // Only message-creation calls carry a prompt; skip count_tokens etc.
  if (!path.endsWith("/messages") || alreadyCaptured(init.body)) return;

  const body = JSON.parse(init.body) as Record<string, unknown>;
  const request = sanitizeValue(body) as Record<string, unknown>;
  logPrompt({
    provider: "anthropic",
    endpoint: path,
    model: typeof body.model === "string" ? body.model : null,
    preview: previewOf(body),
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    request,
  });
}
