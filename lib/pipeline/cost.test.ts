import { describe, expect, it } from "vitest";
import {
  IMAGE_COSTS_USD,
  accumulateUsage,
  imageCostUsd,
} from "./cost";
import { IMAGE_MODELS, resolveImageModel } from "@/lib/clients/gemini-image";
import { IMAGE_MODEL_CATALOG, isImageModelTier } from "@/lib/image-models";

describe("imageCostUsd", () => {
  it("prices every tier's resolved model explicitly (no silent fallback)", () => {
    for (const { id: tier } of IMAGE_MODEL_CATALOG) {
      const model = resolveImageModel(tier);
      expect(IMAGE_COSTS_USD[model]).toBeGreaterThan(0);
      expect(imageCostUsd(model)).toBe(IMAGE_COSTS_USD[model]);
    }
  });

  it("charges pro renders more than lite renders", () => {
    expect(imageCostUsd(IMAGE_MODELS.pro)).toBeGreaterThan(
      imageCostUsd(IMAGE_MODELS.lite),
    );
  });

  it("falls back to the standard estimate for unknown/legacy models", () => {
    expect(imageCostUsd("some-future-model")).toBeGreaterThan(0);
    expect(imageCostUsd(undefined)).toBeGreaterThan(0);
  });
});

describe("accumulateUsage image pricing", () => {
  it("prices an image delta at its own model's rate", () => {
    const pro = accumulateUsage(undefined, { model: IMAGE_MODELS.pro, images: 1 });
    const lite = accumulateUsage(undefined, { model: IMAGE_MODELS.lite, images: 1 });
    expect(pro.images).toBe(1);
    expect(pro.estimated_usd).toBeGreaterThan(lite.estimated_usd);
    expect(pro.estimated_usd).toBeCloseTo(imageCostUsd(IMAGE_MODELS.pro), 4);
  });
});

describe("image model tiers", () => {
  it("resolveImageModel maps every catalog tier and defaults to standard", () => {
    for (const { id: tier } of IMAGE_MODEL_CATALOG) {
      expect(resolveImageModel(tier)).toBe(IMAGE_MODELS[tier]);
    }
    expect(resolveImageModel(undefined)).toBe(IMAGE_MODELS.standard);
  });

  it("isImageModelTier accepts catalog ids and rejects junk", () => {
    expect(isImageModelTier("pro")).toBe(true);
    expect(isImageModelTier("standard")).toBe(true);
    expect(isImageModelTier("ultra")).toBe(false);
    expect(isImageModelTier(undefined)).toBe(false);
  });
});
