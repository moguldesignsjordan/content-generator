import "server-only";
import { z } from "zod";

// Server-only ScrapeCreators client, used to read a Facebook Ad Library page's
// ads. Meta's official Ad Library API only returns political/issue ads for
// US-only delivery, so commercial competitor ads have to come through a
// scraper. Env-var key + isXConfigured() for graceful degradation (mirrors
// lib/clients/dataforseo.ts).
//
// Endpoint verified against docs.scrapecreators.com (2026-10):
// GET /v1/facebook/adLibrary/company/ads?pageId=&country=&status=&sort_by=,
// x-api-key header, 1 credit per request, returns { results: [{ snapshot }] }.
// The docs only show empty `images`/`cards` arrays; the item fields parsed
// below are Meta's own snapshot schema, which ScrapeCreators passes through.

const ENDPOINT = "https://api.scrapecreators.com/v1/facebook/adLibrary/company/ads";
const MAX_ADS = 20;

export function isScrapeCreatorsConfigured(): boolean {
  return Boolean(process.env.SCRAPECREATORS_API_KEY);
}

const mediaSchema = z
  .object({
    original_image_url: z.string().nullish(),
    resized_image_url: z.string().nullish(),
    video_preview_image_url: z.string().nullish(),
  })
  .passthrough();

const cardSchema = mediaSchema.extend({
  body: z.string().nullish(),
  title: z.string().nullish(),
  link_description: z.string().nullish(),
  cta_text: z.string().nullish(),
});

const resultSchema = z
  .object({
    ad_archive_id: z.union([z.string(), z.number()]).transform(String),
    page_name: z.string().nullish(),
    publisher_platform: z.array(z.string()).nullish(),
    start_date: z.number().nullish(),
    snapshot: z
      .object({
        body: z.object({ text: z.string().nullish() }).nullish(),
        title: z.string().nullish(),
        link_description: z.string().nullish(),
        cta_text: z.string().nullish(),
        display_format: z.string().nullish(),
        images: z.array(mediaSchema).nullish(),
        videos: z.array(mediaSchema).nullish(),
        cards: z.array(cardSchema).nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const responseSchema = z
  .object({
    success: z.boolean().nullish(),
    results: z.array(z.unknown()).nullish(),
  })
  .passthrough();

/** One ad from a page, normalized for the import grid and the save route. */
export interface AdLibraryAd {
  adArchiveId: string;
  pageName: string;
  bodyText: string;
  headline: string;
  linkDescription: string;
  ctaText: string;
  imageUrl: string | null;
  isVideo: boolean;
  platforms: string[];
  /** ISO date the ad started running, when known. */
  startDate: string | null;
  /** Dynamic catalog ad: its copy is a `{{product.name}}` template, not real words. */
  isTemplate: boolean;
}

/** The public Ad Library link for one ad, stored as the saved reference's
 * source_url and used to tell which ads are already in the swipe file. */
export function adLibraryAdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

const TEMPLATE_RE = /\{\{[^}]+\}\}/;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function firstImage(items: z.infer<typeof mediaSchema>[] | null | undefined): string | null {
  for (const item of items ?? []) {
    const url = item.original_image_url || item.resized_image_url || item.video_preview_image_url;
    if (url) return url;
  }
  return null;
}

/** Maps one raw result to an AdLibraryAd; null when it has neither copy nor an image. */
export function normalizeAd(raw: unknown): AdLibraryAd | null {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { ad_archive_id, page_name, publisher_platform, start_date, snapshot } = parsed.data;
  // Carousel ads keep their copy on the first card, not the snapshot.
  const card = snapshot.cards?.[0];

  const bodyText = clean(snapshot.body?.text) || clean(card?.body);
  const headline = clean(snapshot.title) || clean(card?.title);
  const linkDescription = clean(snapshot.link_description) || clean(card?.link_description);
  const ctaText = clean(snapshot.cta_text) || clean(card?.cta_text);
  const imageUrl =
    firstImage(snapshot.images) ?? firstImage(snapshot.cards) ?? firstImage(snapshot.videos);
  if (!bodyText && !headline && !imageUrl) return null;

  return {
    adArchiveId: ad_archive_id,
    pageName: clean(page_name),
    bodyText,
    headline,
    linkDescription,
    ctaText,
    imageUrl,
    isVideo: snapshot.display_format === "VIDEO" || Boolean(snapshot.videos?.length),
    platforms: publisher_platform ?? [],
    startDate: start_date ? new Date(start_date * 1000).toISOString().slice(0, 10) : null,
    isTemplate: TEMPLATE_RE.test(`${bodyText} ${headline}`),
  };
}

/**
 * Fetches one page's ads (first page of results, top impressions first) and
 * normalizes them. Throws with a user-readable message on a missing key or a
 * failed request.
 */
export async function fetchPageAds(args: {
  pageId: string;
  country: string;
  status: "ACTIVE" | "INACTIVE" | "ALL";
}): Promise<AdLibraryAd[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    throw new Error("Ad Library import isn't set up: add SCRAPECREATORS_API_KEY to .env.local.");
  }
  const params = new URLSearchParams({
    pageId: args.pageId,
    country: args.country,
    status: args.status,
    sort_by: "total_impressions",
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(45_000),
  });
  const json: unknown = await res.json().catch(() => null);
  const data = responseSchema.safeParse(json);
  if (!res.ok || !data.success || data.data.success === false) {
    throw new Error(`ScrapeCreators request failed (HTTP ${res.status}).`);
  }

  const ads: AdLibraryAd[] = [];
  for (const raw of data.data.results ?? []) {
    const ad = normalizeAd(raw);
    if (ad) ads.push(ad);
    if (ads.length >= MAX_ADS) break;
  }
  return ads;
}
