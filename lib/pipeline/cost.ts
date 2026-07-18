import "server-only";
import { DRAFT_MODEL, FAST_MODEL } from "@/lib/clients/model-ids";
import type { DraftMeta, DraftUsage } from "@/lib/db/types";

// Display-only spend estimates for the review screen's cost panel. Rates from
// the Anthropic pricing table (2026-07): Sonnet 4.6 $3/$15 per MTok, Haiku 4.5
// $1/$5; cache reads bill at 0.1x input, cache writes at 1.25x. Image cost is
// a per-image estimate for the Gemini image model. Estimates, not billing
// truth; keep them honest but don't build invoicing on them.

interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
}

const RATES: Record<string, ModelRates> = {
  [DRAFT_MODEL]: { inputPerMTok: 3, outputPerMTok: 15 },
  [FAST_MODEL]: { inputPerMTok: 1, outputPerMTok: 5 },
};

// Per-render estimates by image model (Gemini pricing, 2026-07). Image usage
// deltas carry the IMAGE model id in `model` (tokens are always 0 on those
// deltas, so the Claude token rates never misfire on them).
export const IMAGE_COSTS_USD: Record<string, number> = {
  "gemini-3.1-flash-lite-image": 0.02,
  "gemini-3.1-flash-image": 0.045,
  "gemini-3-pro-image": 0.134,
};

export const IMAGE_COST_USD = 0.045; // fallback for unknown/legacy image models

export function imageCostUsd(model?: string): number {
  return (model && IMAGE_COSTS_USD[model]) || IMAGE_COST_USD;
}

export interface UsageDelta {
  model: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  images?: number;
}

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
    "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens"
  >,
): number {
  const rates = RATES[model] ?? RATES[DRAFT_MODEL];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  return (
    (input / 1e6) * rates.inputPerMTok +
    (cacheRead / 1e6) * rates.inputPerMTok * 0.1 +
    (cacheWrite / 1e6) * rates.inputPerMTok * 1.25 +
    (output / 1e6) * rates.outputPerMTok
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
