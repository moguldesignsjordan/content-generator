import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto/secrets";
import { facebookProvider } from "./facebook";
import { instagramProvider } from "./instagram";
import type { Brand, BrandIntegration, DraftMeta } from "@/lib/db/types";
import type { PublishInput } from "../provider";

// Request shapes for the two Meta destinations, plus the guards that keep a
// bad post from ever reaching the API.

const GRAPH = "https://graph.facebook.com/v25.0";
const brand = { id: "brand-1" } as Brand;

const meta: DraftMeta = {
  flyer_image: { url: "https://cdn.example/flyer.jpg", alt: "Flyer", width: 1080, height: 1350 },
  flyer_copy: { headline: "Sale", caption: "New drop.", hashtags: ["design"] },
  flyer_aspect: "4:5",
} as DraftMeta;

function integration(config: Record<string, unknown>): BrandIntegration {
  return { provider_id: "x", brand_id: brand.id, config } as BrandIntegration;
}

function input(overrides: Partial<PublishInput>): PublishInput {
  return {
    jobId: "job-1",
    draftId: "draft-1",
    content: { subject: "Sale", preheader: "", html: "" },
    meta,
    brand,
    integration: null,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let token: string;
beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  token = encryptSecret("page-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("facebookProvider", () => {
  it("posts the flyer as a Page photo with the caption and hashtags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "photo-1", post_id: "page_post-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await facebookProvider.publish(
      input({ integration: integration({ pageId: "page-9", pageToken: token }) }),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${GRAPH}/page-9/photos`);
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("url")).toBe("https://cdn.example/flyer.jpg");
    expect(body.get("caption")).toBe("New drop.\n\n#design");
    expect(body.get("access_token")).toBe("page-token");
    expect(result).toEqual({
      externalId: "page_post-1",
      url: "https://www.facebook.com/page_post-1",
    });
  });

  it("surfaces Meta's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { message: "Invalid token", code: 190 } }, 400)),
    );
    await expect(
      facebookProvider.publish(input({ integration: integration({ pageId: "p", pageToken: token }) })),
    ).rejects.toThrow("Invalid token");
  });

  it("is configured only with a stored Page token", () => {
    expect(facebookProvider.isConfigured(brand, integration({ pageId: "p", pageToken: token }))).toBe(true);
    expect(facebookProvider.isConfigured(brand, integration({ pageId: "p" }))).toBe(false);
    expect(facebookProvider.isConfigured(brand, null)).toBe(false);
  });
});

describe("instagramProvider", () => {
  const ig = () => integration({ igUserId: "ig-5", pageToken: token });

  it("creates a container, waits for it, publishes, and reads the permalink", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "container-1" }))
      .mockResolvedValueOnce(json({ status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(json({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(json({ id: "media-1" }))
      .mockResolvedValueOnce(json({ permalink: "https://www.instagram.com/p/abc/" }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = instagramProvider.publish(input({ integration: ig() }));
    await vi.runAllTimersAsync();
    const result = await pending;

    const urls = fetchMock.mock.calls.map((c) => String(c[0]).split("?")[0]);
    expect(urls).toEqual([
      `${GRAPH}/ig-5/media`,
      `${GRAPH}/container-1`,
      `${GRAPH}/container-1`,
      `${GRAPH}/ig-5/media_publish`,
      `${GRAPH}/media-1`,
    ]);
    const create = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect(create.get("image_url")).toBe("https://cdn.example/flyer.jpg");
    expect(create.get("caption")).toBe("New drop.\n\n#design");
    const publish = new URLSearchParams(fetchMock.mock.calls[3][1].body as URLSearchParams);
    expect(publish.get("creation_id")).toBe("container-1");
    expect(result).toEqual({ externalId: "media-1", url: "https://www.instagram.com/p/abc/" });
  });

  it("fails clearly when Instagram can't process the image", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ id: "container-1" }))
        .mockResolvedValueOnce(json({ status_code: "ERROR" })),
    );
    await expect(instagramProvider.publish(input({ integration: ig() }))).rejects.toThrow(
      "couldn't process the image",
    );
  });

  it("refuses story-size flyers before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      instagramProvider.publish(input({ integration: ig(), meta: { ...meta, flyer_aspect: "9:16" } })),
    ).rejects.toThrow("9:16");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
