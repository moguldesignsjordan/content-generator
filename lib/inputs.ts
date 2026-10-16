import {
  MAX_FLYER_REFERENCES,
  MAX_PIECE_PHOTOS,
  type PieceInputs,
  type StyleChoice,
  type StyleImages,
} from "@/lib/db/types";

// One reader and a few writers for PieceInputs, the photos/style/competitor
// ads a piece is made from. Pure, so vitest imports it directly. Briefs,
// draft meta, and campaign state written before PieceInputs kept these as
// separate fields; inputsOf still reads those, and withInputs drops them, so
// a record never carries both shapes.

/** The older per-field shape the brief, draft meta, and campaign state used. */
export interface LegacyInputSource {
  inputs?: PieceInputs;
  product_photo_url?: string;
  photo_url?: string;
  photo_urls?: string[];
  style_reference_urls?: string[];
  reference_urls?: string[];
  look_id?: string;
  competitor_reference_id?: string;
}

const LEGACY_KEYS = [
  "product_photo_url",
  "photo_url",
  "photo_urls",
  "style_reference_urls",
  "reference_urls",
  "competitor_reference_id",
] as const;

function unique(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v))));
}

/** A stored look id as a style: "none" is No reference and "house" is Our
 * style served by the brand's own flyers. */
export function styleFromLookId(lookId: string): StyleChoice {
  if (lookId === "none") return { kind: "none" };
  if (lookId === "house") return { kind: "our" };
  return { kind: "look", look_id: lookId };
}

/** Drops empty lists and caps them, so stored inputs stay small and tidy. */
export function compactInputs(inputs: PieceInputs): PieceInputs {
  const photos = unique(inputs.photos ?? []).slice(0, MAX_PIECE_PHOTOS);
  const styleUrls = unique(inputs.style_images?.urls ?? []).slice(-MAX_FLYER_REFERENCES);
  const styleImages: StyleImages | undefined =
    inputs.style_images && styleUrls.length ? { urls: styleUrls, from: inputs.style_images.from } : undefined;
  // Following style images that aren't there is Our style.
  const style = inputs.style?.kind === "images" && !styleImages ? undefined : inputs.style;
  const ids = unique(inputs.competitor_reference_ids ?? []);
  return {
    ...(photos.length ? { photos } : {}),
    ...(styleImages ? { style_images: styleImages } : {}),
    ...(style ? { style } : {}),
    ...(ids.length ? { competitor_reference_ids: ids } : {}),
  };
}

/**
 * The inputs a piece is made from. The first source carrying `inputs` wins;
 * otherwise the legacy fields of every source are combined in order, so
 * pass the most specific record first (draft meta before its brief).
 */
export function inputsOf(...sources: (LegacyInputSource | null | undefined)[]): PieceInputs {
  for (const source of sources) {
    if (source?.inputs) return source.inputs;
  }
  const photos = sources.flatMap((s) => [s?.product_photo_url, s?.photo_url, ...(s?.photo_urls ?? [])]);
  const styleUrls = unique(
    sources.flatMap((s) => [...(s?.reference_urls ?? []), ...(s?.style_reference_urls ?? [])]),
  );
  const lookId = sources.find((s) => s?.look_id)?.look_id;
  const competitorId = sources.find((s) => s?.competitor_reference_id)?.competitor_reference_id;
  return compactInputs({
    photos: unique(photos),
    ...(styleUrls.length
      ? { style_images: { urls: styleUrls, from: "upload" }, style: { kind: "images" } }
      : lookId
        ? { style: styleFromLookId(lookId) }
        : {}),
    ...(competitorId ? { competitor_reference_ids: [competitorId] } : {}),
  });
}

/** The style a piece follows, with the unset default applied. */
export function effectiveStyle(inputs: PieceInputs): StyleChoice {
  if (inputs.style) return inputs.style;
  return inputs.style_images?.urls.length ? { kind: "images" } : { kind: "our" };
}

/** The style images a piece follows, or null when it follows another style. */
export function followedStyleImages(inputs: PieceInputs): StyleImages | null {
  return effectiveStyle(inputs).kind === "images" && inputs.style_images?.urls.length
    ? inputs.style_images
    : null;
}

/** An email's or blog post's photos: the first leads as the top image, as-is,
 * and the rest go in the body (emails only). With the top image turned off,
 * every one goes in the body. */
export function splitPhotos(
  inputs: PieceInputs,
  brief: { include_image?: boolean } | null | undefined,
): { heroPhoto?: string; bodyPhotos: string[] } {
  const photos = inputs.photos ?? [];
  const heroPhoto = brief?.include_image === false ? undefined : photos[0];
  return { heroPhoto, bodyPhotos: heroPhoto ? photos.slice(1) : photos };
}

/** `record` with `inputs` set (or removed when empty) and its legacy fields
 * dropped, so the two shapes never disagree. */
export function withInputs<T extends LegacyInputSource>(record: T, inputs: PieceInputs): T {
  const next = { ...record };
  for (const key of LEGACY_KEYS) delete next[key];
  const compact = compactInputs(inputs);
  if (Object.keys(compact).length) next.inputs = compact;
  else delete next.inputs;
  return next;
}

/** Photos appended after the ones already there, deduped and capped. */
export function addPhotos(inputs: PieceInputs, urls: string[]): PieceInputs {
  if (!urls.length) return inputs;
  return compactInputs({ ...inputs, photos: [...(inputs.photos ?? []), ...urls] });
}

/**
 * New style images, which become the style. Uploads add to earlier uploads
 * (newest kept over the cap); a fresh pick of competitor ads replaces the
 * last pick. The owner's own uploads are never replaced by ads they tick.
 */
export function withStyleImages(
  inputs: PieceInputs,
  urls: string[],
  from: StyleImages["from"],
): PieceInputs {
  if (!urls.length) return inputs;
  const ownUploads = inputs.style_images?.from === "upload" ? inputs.style_images.urls : null;
  if (from === "competitor" && ownUploads) return inputs;
  const kept = from === "upload" ? (ownUploads ?? []) : [];
  return compactInputs({
    ...inputs,
    style_images: { urls: [...kept, ...urls], from },
    style: { kind: "images" },
  });
}

/** The look picker's value for a piece: null is Our style, "images" the
 * style images, "none" No reference, anything else a saved look's id. */
export function lookPickerValue(inputs: PieceInputs): string | null {
  const style = effectiveStyle(inputs);
  if (style.kind === "our") return null;
  if (style.kind === "none") return "none";
  if (style.kind === "images") return "images";
  return style.look_id;
}

/** The style a look picker tap means. A look id must already be checked as
 * this brand's; "images" (or "ads", once withPickedAds set their images)
 * with no style images is Our style. */
export function styleFromPicker(value: string, inputs: PieceInputs): StyleChoice {
  if (value === "our") return { kind: "our" };
  if (value === "none") return { kind: "none" };
  if (value === "images" || value === "ads") {
    return inputs.style_images?.urls.length ? { kind: "images" } : { kind: "our" };
  }
  return { kind: "look", look_id: value };
}

/**
 * Saved competitor ads picked in the look picker, in pick order: they become
 * the competitor ads (the first shapes the wording) and their images the
 * style. An explicit pick replaces earlier ads and style images, unlike ads
 * ticked passively in the chat (withStyleImages keeps the owner's uploads).
 */
export function withPickedAds(
  inputs: PieceInputs,
  ads: { id: string; image_url: string | null }[],
): PieceInputs {
  if (!ads.length) return inputs;
  const urls = ads
    .map((a) => a.image_url)
    .filter((u): u is string => Boolean(u))
    .slice(0, MAX_FLYER_REFERENCES);
  return compactInputs({
    ...inputs,
    competitor_reference_ids: ads.map((a) => a.id),
    ...(urls.length ? { style_images: { urls, from: "competitor" as const }, style: { kind: "images" as const } } : {}),
  });
}
