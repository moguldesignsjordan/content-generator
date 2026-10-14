import { beforeEach, describe, expect, it, vi } from "vitest";

// renderImage picks the engine from the model key and bills the size it
// actually rendered at; both engines are mocked so no network is touched.
const gemini = vi.fn(async (_args: { model: string }) => ({ data: Buffer.from("g"), mimeType: "image/jpeg" }));
const openai = vi.fn(async (_args: { model: string; quality: string }) => ({
  data: Buffer.from("o"),
  mimeType: "image/jpeg",
}));
vi.mock("./gemini-image", async (orig) => ({
  ...(await orig<typeof import("./gemini-image")>()),
  generateGeminiImage: (a: { model: string }) => gemini(a),
}));
vi.mock("./openai-image", () => ({
  generateOpenAIImage: (a: { model: string; quality: string }) => openai(a),
  isOpenAIImageConfigured: () => true,
}));

import { availableImageTiers, renderImage, resolveImageModel } from "./image-render";

beforeEach(() => {
  gemini.mockClear();
  openai.mockClear();
});

describe("renderImage", () => {
  it("sends Gemini keys to Gemini and bills a raised minimum size", async () => {
    const out = await renderImage({
      model: "gemini-nano-banana-2.1@1K",
      prompt: "p",
      aspectRatio: "4:5",
      minSize: "2K",
    });
    expect(gemini).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-nano-banana-2.1@2K" }));
    expect(out.billedModel).toBe("gemini-nano-banana-2.1@2K");
  });

  it("never shrinks a model that already renders bigger", async () => {
    const out = await renderImage({ model: "gemini-3-pro-image@4K", prompt: "p", aspectRatio: "1:1", minSize: "2K" });
    expect(out.billedModel).toBe("gemini-3-pro-image@4K");
  });

  it("sends OpenAI keys to OpenAI with the model and quality", async () => {
    const out = await renderImage({
      model: "openai:gpt-image-2.5-sunburst@high",
      prompt: "p",
      aspectRatio: "16:9",
      minSize: "2K",
    });
    expect(openai).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-image-2.5-sunburst", quality: "high" }),
    );
    expect(gemini).not.toHaveBeenCalled();
    expect(out.billedModel).toBe("openai:gpt-image-2.5-sunburst@high");
  });
});

describe("with an OpenAI key", () => {
  it("offers and resolves the GPT choices", () => {
    expect(availableImageTiers()).toEqual(expect.arrayContaining(["gpt", "gpt_fast"]));
    expect(resolveImageModel("gpt")).toBe("openai:gpt-image-2.5-sunburst@high");
    expect(resolveImageModel("gpt_fast")).toBe("openai:gpt-image-2.5-flare@medium");
  });
});
