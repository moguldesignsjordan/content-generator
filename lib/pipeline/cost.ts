import "server-only";
import { DRAFT_MODEL, FAST_MODEL } from "@/lib/clients/anthropic";
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

export const IMAGE_COST_USD = 0.04; // ~ Gemini flash-image per render

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

/** Adds one API call's usage onto a rolling DraftUsage, repricing as it goes. */
export function accumulateUsage(
  current: DraftUsage | undefined,
  delta: UsageDelta,
): DraftUsage {
  const base = current ?? emptyUsage();
  const rates = RATES[delta.model] ?? RATES[DRAFT_MODEL];

  const input = delta.input_tokens ?? 0;
  const output = delta.output_tokens ?? 0;
  const cacheRead = delta.cache_read_input_tokens ?? 0;
  const cacheWrite = delta.cache_creation_input_tokens ?? 0;
  const images = delta.images ?? 0;

  const usd =
    (input / 1e6) * rates.inputPerMTok +
    (cacheRead / 1e6) * rates.inputPerMTok * 0.1 +
    (cacheWrite / 1e6) * rates.inputPerMTok * 1.25 +
    (output / 1e6) * rates.outputPerMTok +
    images * IMAGE_COST_USD;

  return {
    input_tokens: base.input_tokens + input,
    output_tokens: base.output_tokens + output,
    cache_read_input_tokens: base.cache_read_input_tokens + cacheRead,
    cache_creation_input_tokens: base.cache_creation_input_tokens + cacheWrite,
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
