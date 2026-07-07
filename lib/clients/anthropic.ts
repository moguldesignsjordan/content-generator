import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { logTokenUsage } from "@/lib/log";

export { DRAFT_MODEL, FAST_MODEL } from "./model-ids";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only Anthropic client.
//
// `server-only` ensures the API key can never be bundled into client code
// (Guardrail #1). The key is read once from the environment.
//
// Model choice: the build docs specify "Sonnet for drafts, Opus for hard
// pieces" (plan §2, v1-guide §5). Email drafting is the Sonnet path.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;

export function isAnthropicConfigured(): boolean {
  return Boolean(apiKey);
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local.");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt caching helpers.
//
// Anthropic caches a prompt prefix up to a `cache_control` breakpoint and
// serves it back at roughly a 90% input-token discount on the next call
// within the cache's rolling 5-minute TTL. Every system prompt in this app
// (brand voice, guidelines, positioning, the email design system) is large
// and reused verbatim across many calls, either every turn of a chat or
// every generation/edit for the same brand, so marking it cacheable is close
// to free money. Use `cacheableSystem` wherever a system prompt is built
// once and reused, and `withCacheBreakpoint` on the last message of a stored
// chat history so each new turn only pays for its own incremental text.
// ─────────────────────────────────────────────────────────────────────────────

/** Wraps a system prompt string as a single cacheable content block. */
export function cacheableSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/**
 * Marks the last content block of a message as a cache breakpoint, so the
 * full prefix up to and including it (tools + system + every earlier turn)
 * is cached. Call this on the last message of stored history BEFORE
 * appending the newest user message, so each turn reuses everything except
 * that one new message.
 */
export function withCacheBreakpoint(
  message: Anthropic.MessageParam,
): Anthropic.MessageParam {
  const content =
    typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : [...message.content];
  if (content.length === 0) return message;
  const last = {
    ...content[content.length - 1],
    cache_control: { type: "ephemeral" as const },
  };
  return { ...message, content: [...content.slice(0, -1), last] };
}

/**
 * Logs a one-line breakdown of an Anthropic response's token usage, focused
 * on whether the prompt cache landed. `cache_write` is tokens we paid 1.25x
 * to seed (the first call for a given prefix); `cache_read` is tokens we got
 * at a 0.1x hit. If both stay 0 across calls, the prefix isn't being cached
 * — almost always because it's under the model's minimum cacheable length
 * (1,024 tokens for Sonnet 4.6). Pass a short label to tell calls apart in
 * the server log. Intended for dev-time verification; safe to leave on.
 *
 * Also persists the call as a `usage` row in app_logs (see lib/log.ts) so
 * token spend is visible on the /logs page, not just in server console output.
 */
export function logUsage(
  label: string,
  model: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
  opts?: { draftId?: string },
): void {
  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const totalInput = input + cacheWrite + cacheRead;
  const verdict =
    cacheRead > 0 ? "CACHE HIT" : cacheWrite > 0 ? "cache seed" : "no cache";
  console.log(
    `[usage:${label}] input=${input} cache_write=${cacheWrite} cache_read=${cacheRead} output=${output} (${verdict}, ${totalInput} total input)`,
  );
  logTokenUsage(label, model, usage, opts);
}
