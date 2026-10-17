import "server-only";
import { DRAFT_MODEL, FAST_MODEL, HARD_MODEL } from "@/lib/clients/model-ids";
import type { DraftMeta, DraftUsage } from "@/lib/db/types";

// Display-only spend estimates for the review screen's cost panel. Rates from
// the Anthropic prompt-caching pricing table (checked 2026-10-17): Sonnet 5
// $2/$10 per MTok, Opus 5 $5/$25, Haiku 5.5 $0.10/$0.50 (its rate for prompts
// up to 100K tokens); cache reads bill at 0.1x input, cache writes at 1.25x.
// Image cost is a per-image estimate for the Gemini image model. Estimates, not
// billing truth; keep them honest but don't build invoicing on them.

interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
}

const RATES: Record<string, ModelRates> = {
  [DRAFT_MODEL]: { inputPerMTok: 2, outputPerMTok: 10 },
  [HARD_MODEL]: { inputPerMTok: 5, outputPerMTok: 25 },
  [FAST_MODEL]: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

// Per-render prices by model key (see lib/clients/image-render.ts),
// from the Gemini API pricing page (checked 2026-10). Image usage deltas carry
// that key in `model` (tokens are always 0 on those deltas, so the Claude
// token rates never misfire on them). Bare ids are legacy 1K rows in logs.
export const IMAGE_COSTS_USD: Record<string, number> = {
  "gemini-nano-banana-2.1@1K": 0.0336,
  "gemini-nano-banana-2.1@2K": 0.0504,
  "gemini-nano-banana-2.1@4K": 0.113,
  "gemini-3-pro-image@1K": 0.134,
  "gemini-3-pro-image@2K": 0.134,
  "gemini-3-pro-image@4K": 0.24,
  // GPT Image 2.5 bills per token ($30/M output, $8/M image input); these are
  // OpenAI's published per-image figures at 1024px (high ~$0.21, medium
  // ~$0.053). Reference images add input tokens on top, not counted here.
  "openai:gpt-image-2.5-sunburst@high": 0.211,
  "openai:gpt-image-2.5-flare@medium": 0.053,
  "gemini-3.1-flash-lite-image": 0.0336,
  "gemini-3.1-flash-image": 0.067,
  "gemini-3-pro-image": 0.134,
};

export const IMAGE_COST_USD = 0.067; // fallback for unknown image models

export function imageCostUsd(model?: string): number {
  return (model && IMAGE_COSTS_USD[model]) || IMAGE_COST_USD;
}

export interface UsageDelta {
  model: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  /** Present on calls that used the server-side web search tool; each search
   * bills separately from tokens (WEB_SEARCH_COST_USD). */
  server_tool_use?: { web_search_requests?: number | null } | null;
  images?: number;
}

/** Anthropic's web search tool: $10 per 1,000 searches, on top of tokens. */
export const WEB_SEARCH_COST_USD = 0.01;

export function emptyUsage(): DraftUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    images: 0,
    estimated_usd: 0,
  };
}

/** Prices one call's token usage (no images) at a model's per-MTok rates.
 * Shared by accumulateUsage (draft cost rollup) and lib/log.ts (per-call
 * usage rows), so the pricing formula lives in exactly one place. */
export function priceUsage(
  model: string,
  usage: Pick<
    UsageDelta,
    | "input_tokens"
    | "output_tokens"
    | "cache_read_input_tokens"
    | "cache_creation_input_tokens"
    | "server_tool_use"
  >,
): number {
  const rates = RATES[model] ?? RATES[DRAFT_MODEL];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;

  return (
    (input / 1e6) * rates.inputPerMTok +
    (cacheRead / 1e6) * rates.inputPerMTok * 0.1 +
    (cacheWrite / 1e6) * rates.inputPerMTok * 1.25 +
    (output / 1e6) * rates.outputPerMTok +
    searches * WEB_SEARCH_COST_USD
  );
}

/** Adds one API call's usage onto a rolling DraftUsage, repricing as it goes. */
export function accumulateUsage(
  current: DraftUsage | undefined,
  delta: UsageDelta,
): DraftUsage {
  const base = current ?? emptyUsage();
  const images = delta.images ?? 0;
  const usd = priceUsage(delta.model, delta) + images * imageCostUsd(delta.model);

  return {
    input_tokens: base.input_tokens + (delta.input_tokens ?? 0),
    output_tokens: base.output_tokens + (delta.output_tokens ?? 0),
    cache_read_input_tokens:
      base.cache_read_input_tokens + (delta.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      base.cache_creation_input_tokens + (delta.cache_creation_input_tokens ?? 0),
    images: base.images + images,
    estimated_usd: Number((base.estimated_usd + usd).toFixed(4)),
  };
}

/** Convenience: returns a meta patch with the delta folded into meta.usage. */
export function usageMetaPatch(
  meta: DraftMeta,
  delta: UsageDelta,
): Pick<DraftMeta, "usage"> {
  return { usage: accumulateUsage(meta.usage, delta) };
}
