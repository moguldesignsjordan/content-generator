import { describe, expect, it } from "vitest";
import { splitImageModel } from "./gemini-image";
import { IMAGE_MODELS, availableImageTiers } from "./image-render";
import { IMAGE_COSTS_USD, imageCostUsd } from "@/lib/pipeline/cost";

describe("image model tiers", () => {
  it("splits a tier key into the model id and output size", () => {
    expect(splitImageModel("gemini-nano-banana-2.1@2K")).toEqual({
      id: "gemini-nano-banana-2.1",
      size: "2K",
    });
    // A bare id (an env override, or an old log row) renders at 1K.
    expect(splitImageModel("gemini-3.1-flash-image")).toEqual({
      id: "gemini-3.1-flash-image",
      size: "1K",
    });
  });

  it("has a real price for every default tier, so nothing falls back to a guess", () => {
    for (const key of Object.values(IMAGE_MODELS) as string[]) {
      expect(IMAGE_COSTS_USD[key], key).toBeGreaterThan(0);
    }
  });

  it("only offers GPT choices when an OpenAI key is set, and never the legacy lite", () => {
    const tiers = availableImageTiers();
    expect(tiers).not.toContain("lite");
    expect(tiers).toContain("standard");
    expect(tiers).toContain("pro");
    expect(tiers.includes("gpt")).toBe(Boolean(process.env.OPENAI_API_KEY));
  });

  it("prices the size, not just the model", () => {
    expect(imageCostUsd("gemini-nano-banana-2.1@1K")).toBe(0.0336);
    expect(imageCostUsd("gemini-nano-banana-2.1@2K")).toBe(0.0504);
    expect(imageCostUsd("gemini-3-pro-image@2K")).toBe(0.134);
  });
});
