import { describe, expect, it } from "vitest";
import {
  addPhotos,
  compactInputs,
  effectiveStyle,
  followedStyleImages,
  inputsOf,
  lookPickerValue,
  splitPhotos,
  styleFromPicker,
  withInputs,
  withStyleImages,
} from "./inputs";

describe("inputsOf", () => {
  it("uses the first source that carries inputs", () => {
    const inputs = { photos: ["https://x/a.jpg"] };
    expect(inputsOf({ inputs }, { product_photo_url: "https://x/old.jpg" })).toBe(inputs);
    expect(inputsOf(null, { inputs })).toBe(inputs);
  });

  it("reads a legacy brief: hero first, then the email photos", () => {
    expect(
      inputsOf({
        product_photo_url: "https://x/hero.jpg",
        photo_urls: ["https://x/1.jpg", "https://x/hero.jpg", "https://x/2.jpg"],
        style_reference_urls: ["https://x/s.jpg"],
        competitor_reference_id: "c1",
      }),
    ).toEqual({
      photos: ["https://x/hero.jpg", "https://x/1.jpg", "https://x/2.jpg"],
      style_images: { urls: ["https://x/s.jpg"], from: "upload" },
      style: { kind: "images" },
      competitor_reference_ids: ["c1"],
    });
  });

  it("reads legacy draft meta and campaign state, meta before brief", () => {
    expect(inputsOf({ reference_urls: ["https://x/r.jpg"], look_id: "l1" })).toEqual({
      style_images: { urls: ["https://x/r.jpg"], from: "upload" },
      style: { kind: "images" },
    });
    expect(inputsOf({ look_id: "none" }).style).toEqual({ kind: "none" });
    expect(inputsOf({ look_id: "house" }).style).toEqual({ kind: "our" });
    expect(inputsOf({ look_id: "l1" }).style).toEqual({ kind: "look", look_id: "l1" });
    expect(inputsOf({ photo_url: "https://x/f.jpg" }, { product_photo_url: "https://x/b.jpg" }).photos).toEqual([
      "https://x/f.jpg",
      "https://x/b.jpg",
    ]);
  });

  it("is empty when nothing was supplied", () => {
    expect(inputsOf({}, undefined, null)).toEqual({});
  });
});

describe("compactInputs", () => {
  it("drops empty lists and caps photos and style images", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`);
    const out = compactInputs({
      photos: urls,
      style_images: { urls, from: "upload" },
      competitor_reference_ids: [],
    });
    expect(out.photos).toHaveLength(8);
    expect(out.style_images).toEqual({ urls: urls.slice(-3), from: "upload" });
    expect(out).not.toHaveProperty("competitor_reference_ids");
  });

  it("drops a choice of style images when there are none", () => {
    expect(compactInputs({ style: { kind: "images" }, style_images: { urls: [], from: "upload" } })).toEqual({});
  });
});

describe("effective style", () => {
  const images = { urls: ["https://x/a.jpg"], from: "competitor" as const };

  it("follows the style images when nothing was picked, else Our style", () => {
    expect(effectiveStyle({ style_images: images })).toEqual({ kind: "images" });
    expect(followedStyleImages({ style_images: images })).toBe(images);
    expect(effectiveStyle({})).toEqual({ kind: "our" });
  });

  it("keeps the style images while Our style is picked", () => {
    const inputs = { style_images: images, style: { kind: "our" as const } };
    expect(followedStyleImages(inputs)).toBeNull();
    expect(lookPickerValue(inputs)).toBeNull();
    expect(styleFromPicker("images", inputs)).toEqual({ kind: "images" });
  });
});

describe("splitPhotos", () => {
  const photos = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"];

  it("leads with the first photo and places the rest in the body", () => {
    expect(splitPhotos({ photos }, {})).toEqual({
      heroPhoto: "https://x/1.jpg",
      bodyPhotos: ["https://x/2.jpg", "https://x/3.jpg"],
    });
  });

  it("puts every photo in the body when the top image is off", () => {
    expect(splitPhotos({ photos }, { include_image: false })).toEqual({ heroPhoto: undefined, bodyPhotos: photos });
    expect(splitPhotos({}, null)).toEqual({ heroPhoto: undefined, bodyPhotos: [] });
  });
});

describe("withInputs", () => {
  it("sets inputs and drops the legacy fields", () => {
    const out = withInputs(
      { goal: "Sell cards", product_photo_url: "https://x/a.jpg", photo_urls: ["https://x/b.jpg"] },
      { photos: ["https://x/a.jpg"] },
    );
    expect(out).toEqual({ goal: "Sell cards", inputs: { photos: ["https://x/a.jpg"] } });
  });

  it("removes inputs when they come out empty", () => {
    expect(withInputs({ goal: "g", inputs: { photos: ["https://x/a.jpg"] } }, {})).toEqual({ goal: "g" });
  });
});

describe("addPhotos and withStyleImages", () => {
  it("appends photos without duplicates", () => {
    expect(addPhotos({ photos: ["https://x/a.jpg"] }, ["https://x/a.jpg", "https://x/b.jpg"]).photos).toEqual([
      "https://x/a.jpg",
      "https://x/b.jpg",
    ]);
  });

  it("adds uploads to uploads, and a new ad pick replaces the last one", () => {
    const uploaded = withStyleImages({}, ["https://x/u1.jpg"], "upload");
    expect(withStyleImages(uploaded, ["https://x/u2.jpg"], "upload").style_images).toEqual({
      urls: ["https://x/u1.jpg", "https://x/u2.jpg"],
      from: "upload",
    });
    const picked = withStyleImages({ style: { kind: "our" } }, ["https://x/ad1.jpg"], "competitor");
    expect(picked.style).toEqual({ kind: "images" });
    expect(withStyleImages(picked, ["https://x/ad2.jpg"], "competitor").style_images).toEqual({
      urls: ["https://x/ad2.jpg"],
      from: "competitor",
    });
  });

  it("never lets ticked ads replace the owner's own style images", () => {
    const uploaded = withStyleImages({}, ["https://x/u1.jpg"], "upload");
    expect(withStyleImages(uploaded, ["https://x/ad.jpg"], "competitor")).toBe(uploaded);
  });
});

describe("look picker values", () => {
  it("maps each style to a picker value and back", () => {
    expect(lookPickerValue({})).toBeNull();
    expect(lookPickerValue({ style: { kind: "none" } })).toBe("none");
    expect(lookPickerValue({ style: { kind: "look", look_id: "l1" } })).toBe("l1");
    expect(styleFromPicker("our", {})).toEqual({ kind: "our" });
    expect(styleFromPicker("images", {})).toEqual({ kind: "our" });
    expect(styleFromPicker("none", {})).toEqual({ kind: "none" });
    expect(styleFromPicker("l1", {})).toEqual({ kind: "look", look_id: "l1" });
  });
});
