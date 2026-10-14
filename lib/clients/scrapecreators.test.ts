import { describe, expect, it } from "vitest";
import { normalizeAd } from "./scrapecreators";

const base = {
  ad_archive_id: "1234",
  page_name: "Acme",
  publisher_platform: ["FACEBOOK", "INSTAGRAM"],
  start_date: 1740643200,
};

describe("normalizeAd", () => {
  it("maps an image ad's copy, image, and start date", () => {
    expect(
      normalizeAd({
        ...base,
        snapshot: {
          body: { text: "Stop guessing. Start growing." },
          title: "Free audit",
          link_description: "Takes 2 minutes",
          cta_text: "Learn more",
          display_format: "IMAGE",
          images: [{ original_image_url: "https://scontent.xx.fbcdn.net/a.jpg" }],
          videos: [],
          cards: [],
        },
      }),
    ).toEqual({
      adArchiveId: "1234",
      pageName: "Acme",
      bodyText: "Stop guessing. Start growing.",
      headline: "Free audit",
      linkDescription: "Takes 2 minutes",
      ctaText: "Learn more",
      imageUrl: "https://scontent.xx.fbcdn.net/a.jpg",
      isVideo: false,
      platforms: ["FACEBOOK", "INSTAGRAM"],
      startDate: "2025-02-27",
      isTemplate: false,
    });
  });

  it("uses a video's preview frame as the image", () => {
    const ad = normalizeAd({
      ...base,
      snapshot: {
        body: { text: "Watch this" },
        display_format: "VIDEO",
        videos: [{ video_preview_image_url: "https://scontent.xx.fbcdn.net/v.jpg" }],
      },
    });
    expect(ad?.isVideo).toBe(true);
    expect(ad?.imageUrl).toBe("https://scontent.xx.fbcdn.net/v.jpg");
  });

  it("falls back to the first carousel card for copy and image", () => {
    const ad = normalizeAd({
      ...base,
      snapshot: {
        body: { text: "" },
        cards: [
          {
            body: "Card copy",
            title: "Card headline",
            cta_text: "Shop now",
            resized_image_url: "https://scontent.xx.fbcdn.net/c.jpg",
          },
        ],
      },
    });
    expect(ad).toMatchObject({
      bodyText: "Card copy",
      headline: "Card headline",
      ctaText: "Shop now",
      imageUrl: "https://scontent.xx.fbcdn.net/c.jpg",
    });
  });

  it("flags dynamic catalog ads whose copy is a template", () => {
    const ad = normalizeAd({
      ...base,
      snapshot: { body: { text: "{{product.brand}}" }, title: "{{product.name}}" },
    });
    expect(ad?.isTemplate).toBe(true);
  });

  it("drops ads with no copy and no image, and malformed results", () => {
    expect(normalizeAd({ ...base, snapshot: { body: { text: "" } } })).toBeNull();
    expect(normalizeAd({ page_name: "no id" })).toBeNull();
  });
});
