import "server-only";
import * as cheerio from "cheerio";
import { fetchBinary, fetchHtml, fetchText } from "./fetch-page";
import { assertPublicHost, normalizeSiteUrl } from "./url";
import { optimizeEmailImage } from "@/lib/images/optimize";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { emailHtmlToText, slugify, stripEmDashes } from "@/lib/text";
import type { ProposedProduct } from "@/lib/db/types";

// Finds a site's products and services with their photos, from structured
// data only: the sitemaps (robots.txt, sitemap.xml, one level of sitemap
// index), offer-like links on the homepage (a product, a service, a menu
// item, a class), the site's own shop subdomains (print., shop., ...), and
// Shopify's /products.json. Each page is read for JSON-LD (Product, Service,
// Course, MenuItem) first, then Open Graph. Sites with none of that fall back
// to the website import's text extraction in the route, and addShareImages
// gives those offers their page's photo. Nothing here writes to the DB.

const MAX_PAGES = 30;
const MAX_SUBDOMAINS = 3;
const MAX_CHILD_SITEMAPS = 4;
const CONCURRENCY = 3;
const TOTAL_BUDGET_MS = 45_000;
const SITEMAP_BYTES = 2_000_000;

const PRODUCT_PATH =
  /\/(products?|shop|store|items?|p|catalog|collections\/[^/]+\/products|services?|what-we-do|solutions|packages?|offerings?|treatments?|menu|classes|courses?|programs?|listings?)\/[^/?#]+/i;
const SHOP_SUBDOMAIN = /^(print|shop|store|buy|products?)\./i;
const NOT_A_PRODUCT =
  /\/(about|contact|cart|checkout|account|login|blog|news|faq|privacy|terms|policies|search|tag|category|collections?)\/?$/i;

export interface ScrapedProducts {
  origin: string;
  products: ProposedProduct[];
}

function clean(value: unknown, max = 600): string {
  if (typeof value !== "string") return "";
  return stripEmDashes(emailHtmlToText(value)).replace(/\s+/g, " ").trim().slice(0, max);
}

/** "Business Cards | Mogul Print" is "Business Cards". */
function stripSiteSuffix(title: string): string {
  return title.split(/\s+[|\u2013]\s+|\s+-\s+/)[0].trim();
}

function absolute(url: unknown, base: URL): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    const out = new URL(url.trim(), base);
    return out.protocol === "http:" || out.protocol === "https:" ? out.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatPrice(amount: unknown, currency: unknown): string | undefined {
  const value = typeof amount === "number" ? String(amount) : typeof amount === "string" ? amount.trim() : "";
  if (!value || !/\d/.test(value)) return undefined;
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (!code || code === "USD") return value.startsWith("$") ? value : `$${value}`;
  return `${value} ${code}`;
}

/** Sitemap URLs listed in robots.txt. */
export function sitemapsFromRobots(robots: string, base: URL): string[] {
  return robots
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
    .map((url) => absolute(url, base))
    .filter((url): url is string => Boolean(url));
}

/** A sitemap's page URLs, or its child sitemaps when it's an index. */
export function parseSitemap(xml: string): { pages: string[]; children: string[] } {
  const $ = cheerio.load(xml, { xml: true });
  const locs = (selector: string) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  return { pages: locs("urlset > url > loc"), children: locs("sitemapindex > sitemap > loc") };
}

/** True for a path that looks like one product's page. */
export function isProductPath(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return PRODUCT_PATH.test(path) && !NOT_A_PRODUCT.test(path);
  } catch {
    return false;
  }
}

/** The site's own domain without "www.". */
function baseDomain(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Homepage links: product-like pages, and the site's own shop subdomains. */
export function linksFromHome(html: string, origin: URL): { products: string[]; subdomains: string[] } {
  const $ = cheerio.load(html);
  const domain = baseDomain(origin.hostname);
  const products = new Set<string>();
  const subdomains = new Set<string>();
  $("a[href]").each((_, el) => {
    const url = absolute($(el).attr("href"), origin);
    if (!url) return;
    const parsed = new URL(url);
    parsed.hash = "";
    const host = parsed.hostname.toLowerCase();
    if (host !== origin.hostname.toLowerCase() && host.endsWith(`.${domain}`) && SHOP_SUBDOMAIN.test(host)) {
      subdomains.add(`${parsed.protocol}//${parsed.host}`);
    }
    if ((host === origin.hostname.toLowerCase() || host.endsWith(`.${domain}`)) && isProductPath(parsed.toString())) {
      products.add(parsed.toString());
    }
  });
  return { products: [...products], subdomains: [...subdomains].slice(0, MAX_SUBDOMAINS) };
}

interface JsonLdNode {
  "@type"?: unknown;
  "@graph"?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  offers?: unknown;
  url?: unknown;
}

const OFFER_TYPES = new Set(["Product", "ProductGroup", "IndividualProduct", "Service", "Course", "MenuItem"]);

function isProductType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && OFFER_TYPES.has(t));
}

function findProductNode(value: unknown): JsonLdNode | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findProductNode(v);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const node = value as JsonLdNode;
  if (isProductType(node["@type"])) return node;
  return node["@graph"] ? findProductNode(node["@graph"]) : null;
}

function firstImage(image: unknown, base: URL): string | undefined {
  if (Array.isArray(image)) return firstImage(image[0], base);
  if (image && typeof image === "object") return absolute((image as { url?: unknown }).url, base);
  return absolute(image, base);
}

function offerPrice(offers: unknown): string | undefined {
  const offer = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown> | undefined;
  if (!offer || typeof offer !== "object") return undefined;
  const amount = offer.price ?? offer.lowPrice;
  const price = formatPrice(amount, offer.priceCurrency);
  return price && offer.lowPrice !== undefined && offer.price === undefined ? `From ${price}` : price;
}

/** One page's product: JSON-LD Product first, then Open Graph. Null when the
 * page carries neither. */
export function parseProductPage(html: string, pageUrl: string): ProposedProduct | null {
  const base = new URL(pageUrl);
  const $ = cheerio.load(html);
  let node: JsonLdNode | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (node) return;
    try {
      node = findProductNode(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD is common; Open Graph is the fallback.
    }
  });
  const meta = (key: string) =>
    $(`meta[property="${key}"]`).attr("content") ?? $(`meta[name="${key}"]`).attr("content");

  const found = node as JsonLdNode | null;
  const name = clean(found?.name, 120) || stripSiteSuffix(clean(meta("og:title"), 160));
  if (!name) return null;
  if (!found && !meta("og:image") && !meta("product:price:amount") && meta("og:type") !== "product") {
    return null;
  }
  const description = clean(found?.description) || clean(meta("og:description"));
  const image = firstImage(found?.image, base) ?? absolute(meta("og:image"), base);
  const price =
    (found ? offerPrice(found.offers) : undefined) ??
    formatPrice(
      meta("product:price:amount") ?? meta("og:price:amount"),
      meta("product:price:currency") ?? meta("og:price:currency"),
    );
  return {
    slug: slugify(name),
    name,
    ...(description ? { description } : {}),
    ...(price ? { price_point: price } : {}),
    url: absolute(found?.url, base) ?? pageUrl,
    ...(image ? { image_url: image } : {}),
  };
}

/** Shopify's public /products.json, as products. */
export function parseShopifyProducts(json: string, origin: URL): ProposedProduct[] {
  let data: { products?: unknown };
  try {
    data = JSON.parse(json) as { products?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(data.products)) return [];
  return data.products.flatMap((raw) => {
    const p = raw as {
      title?: unknown;
      handle?: unknown;
      body_html?: unknown;
      images?: { src?: unknown }[];
      variants?: { price?: unknown }[];
    };
    const name = clean(p.title, 120);
    if (!name) return [];
    const description = clean(p.body_html);
    const price = formatPrice(p.variants?.[0]?.price, "USD");
    const image = absolute(p.images?.[0]?.src, origin);
    const handle = typeof p.handle === "string" ? p.handle : slugify(name);
    return [
      {
        slug: slugify(name),
        name,
        ...(description ? { description } : {}),
        ...(price ? { price_point: price } : {}),
        url: new URL(`/products/${handle}`, origin).toString(),
        ...(image ? { image_url: image } : {}),
      },
    ];
  });
}

/** "web-design" in the page address is "Web Design". */
export function nameFromUrl(url: string | undefined): string {
  try {
    const segment = decodeURIComponent(new URL(url ?? "").pathname.split("/").filter(Boolean).pop() ?? "");
    return segment
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function homeTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr("content") ?? $("title").first().text();
  return stripSiteSuffix(clean(title, 160)) || undefined;
}

/**
 * Many service sites reuse one site-wide title, description, and share image
 * on every page. A value on 2+ pages (or a name matching the homepage's
 * title) is that default, not the offer's own: the name comes from the page
 * address instead, and a shared description or photo is dropped.
 */
export function dropSiteDefaults(pages: ProposedProduct[], siteTitle?: string): ProposedProduct[] {
  const shared = (pick: (p: ProposedProduct) => string | undefined) => {
    const pagesBy = new Map<string, Set<string | undefined>>();
    for (const p of pages) {
      const value = pick(p);
      if (value) pagesBy.set(value, (pagesBy.get(value) ?? new Set()).add(p.url));
    }
    return new Set([...pagesBy].filter(([, urls]) => urls.size > 1).map(([value]) => value));
  };
  const names = shared((p) => p.name.toLowerCase());
  const descriptions = shared((p) => p.description);
  const images = shared((p) => p.image_url);
  return pages.flatMap((p) => {
    const generic = names.has(p.name.toLowerCase()) || p.name.toLowerCase() === siteTitle?.toLowerCase();
    const name = generic ? nameFromUrl(p.url) : p.name;
    if (!name) return [];
    const { description, image_url, ...rest } = p;
    return [
      {
        ...rest,
        name,
        slug: generic ? slugify(name) : p.slug,
        ...(description && !descriptions.has(description) ? { description } : {}),
        ...(image_url && !images.has(image_url) ? { image_url } : {}),
      },
    ];
  });
}

/** Product pages one host's sitemaps list. */
async function sitemapProductUrls(host: URL): Promise<string[]> {
  const robots = await fetchText(new URL("/robots.txt", host), { maxBytes: 100_000 });
  const roots = robots ? sitemapsFromRobots(robots, host) : [];
  if (!roots.length) roots.push(new URL("/sitemap.xml", host).toString());
  const pages: string[] = [];
  for (const root of roots.slice(0, 2)) {
    const xml = await fetchText(new URL(root), { maxBytes: SITEMAP_BYTES });
    if (!xml) continue;
    const { pages: direct, children } = parseSitemap(xml);
    pages.push(...direct);
    // Product sitemaps first ("sitemap-products.xml", "product-sitemap.xml").
    const ordered = [...children].sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)));
    for (const child of ordered.slice(0, MAX_CHILD_SITEMAPS)) {
      const childXml = await fetchText(new URL(child), { maxBytes: SITEMAP_BYTES });
      if (childXml) pages.push(...parseSitemap(childXml).pages);
    }
  }
  return pages.filter(isProductPath);
}

/**
 * The site's products from structured data, deduped by name, at most
 * MAX_PAGES pages read. An empty list means the route should fall back to
 * text extraction. Throws ScrapeError for an invalid or private URL.
 */
export async function scrapeProducts(inputUrl: string): Promise<ScrapedProducts> {
  const started = Date.now();
  const url = normalizeSiteUrl(inputUrl);
  await assertPublicHost(url.hostname);
  const home = await fetchHtml(url);
  const origin = new URL((home?.finalUrl ?? url).origin);
  const links = home ? linksFromHome(home.html, origin) : { products: [], subdomains: [] };
  const hosts = [origin, ...links.subdomains.map((s) => new URL(s))];

  const products = new Map<string, ProposedProduct>();
  const add = (p: ProposedProduct) => {
    if (p.slug && !products.has(p.slug)) products.set(p.slug, p);
  };

  const candidates = new Set<string>(links.products);
  for (const host of hosts) {
    if (Date.now() - started > TOTAL_BUDGET_MS) break;
    const shopify = await fetchText(new URL("/products.json?limit=250", host), { maxBytes: SITEMAP_BYTES });
    const fromShopify = shopify ? parseShopifyProducts(shopify, host) : [];
    if (fromShopify.length) {
      fromShopify.forEach(add);
      continue;
    }
    for (const page of await sitemapProductUrls(host).catch(() => [])) candidates.add(page);
  }

  const queue = [...candidates].slice(0, MAX_PAGES);
  const scanned: ProposedProduct[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length || Date.now() - started > TOTAL_BUDGET_MS) return;
      const page = await fetchHtml(new URL(queue[i]));
      const product = page ? parseProductPage(page.html, page.finalUrl.toString()) : null;
      if (product) scanned.push(product);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  dropSiteDefaults(scanned, home ? homeTitle(home.html) : undefined).forEach(add);
  return { origin: origin.origin, products: [...products.values()] };
}

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Copies a product photo from someone else's site into our storage, so the
 * image pipeline can fetch it. Null when it can't be downloaded. */
export async function mirrorProductPhoto(sourceUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }
  const img = await fetchBinary(parsed, { allowedTypes: PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES });
  if (!img?.bytes.byteLength) return null;
  const optimized = await optimizeEmailImage(img.bytes);
  const { url } = await uploadContentImage(optimized.data, optimized.format);
  return url;
}

const MAX_SHARE_IMAGES = 12;

/** The page's share image (og:image), absolute. */
export function shareImage(html: string, pageUrl: string): string | undefined {
  const $ = cheerio.load(html);
  const content =
    $('meta[property="og:image"]').attr("content") ?? $('meta[name="twitter:image"]').attr("content");
  return absolute(content, new URL(pageUrl));
}

/** Text-extracted offers get their own page's share image as a photo, when
 * the page is on the site being imported. */
export async function addShareImages(products: ProposedProduct[], origin: string): Promise<ProposedProduct[]> {
  const domain = baseDomain(new URL(origin).hostname);
  const onSite = (url?: string) => {
    try {
      const host = new URL(url ?? "").hostname.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  };
  const todo = products.filter((p) => !p.image_url && onSite(p.url)).slice(0, MAX_SHARE_IMAGES);
  const images = new Map<string, string>();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const product = todo[cursor++];
      if (!product) return;
      const page = await fetchHtml(new URL(product.url!)).catch(() => null);
      const image = page ? shareImage(page.html, page.finalUrl.toString()) : undefined;
      if (image) images.set(product.slug, image);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return products.map((p) => (images.has(p.slug) ? { ...p, image_url: images.get(p.slug) } : p));
}

/**
 * The text extraction's offers (richer words: deliverables, stated prices)
 * with the structured scan's photos and prices filled in where they match
 * by slug or link, plus any offer only the scan found.
 */
export function mergeProducts(extracted: ProposedProduct[], structured: ProposedProduct[]): ProposedProduct[] {
  const used = new Set<ProposedProduct>();
  const merged = extracted.map((p) => {
    const match = structured.find((s) => !used.has(s) && (s.slug === p.slug || (p.url && s.url === p.url)));
    if (!match) return p;
    used.add(match);
    return {
      ...p,
      ...(!p.image_url && match.image_url ? { image_url: match.image_url } : {}),
      ...(!p.price_point && match.price_point ? { price_point: match.price_point } : {}),
      ...(!p.url && match.url ? { url: match.url } : {}),
    };
  });
  return [...merged, ...structured.filter((s) => !used.has(s))];
}
