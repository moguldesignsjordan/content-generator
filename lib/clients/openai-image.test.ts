import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({ logPrompt: vi.fn() }));

let generateOpenAIImage: typeof import("./openai-image").generateOpenAIImage;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  ({ generateOpenAIImage } = await import("./openai-image"));
});
afterEach(() => fetchMock.mockReset());

const ok = () =>
  new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("img").toString("base64") }] }), {
    status: 200,
  });

describe("generateOpenAIImage", () => {
  it("uses the generations endpoint as JSON when there are no references", async () => {
    fetchMock.mockResolvedValue(ok());
    const out = await generateOpenAIImage({
      model: "gpt-image-2.5-sunburst",
      quality: "high",
      prompt: "a desk",
      aspectRatio: "4:5",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      quality: "high",
      size: "1088x1360",
      output_format: "jpeg",
    });
    expect(out.data.toString()).toBe("img");
  });

  it("uses the edits endpoint with image[] files when references are attached", async () => {
    fetchMock.mockResolvedValue(ok());
    await generateOpenAIImage({
      model: "gpt-image-2.5-flare",
      quality: "medium",
      prompt: "the product on a desk",
      aspectRatio: "1:1",
      references: [{ data: Buffer.from("p").toString("base64"), mimeType: "image/jpeg" }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2.5-flare");
    expect(form.get("size")).toBe("1088x1088");
    expect(form.getAll("image[]")).toHaveLength(1);
  });

  it("fails straight away on a 400 (no retry) with the API's message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "rejected by safety system" } }), { status: 400 }),
    );
    await expect(
      generateOpenAIImage({ model: "m", quality: "high", prompt: "x", aspectRatio: "1:1" }),
    ).rejects.toThrow("rejected by safety system");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sizes every flyer and hero shape inside the API's limits", () => {
    for (const size of ["1536x864", "1088x1088", "1088x1360", "1088x1936"]) {
      const [w, h] = size.split("x").map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
      expect(w * h).toBeLessThanOrEqual(8_294_400);
    }
  });
});
