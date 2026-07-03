import "server-only";
import * as cheerio from "cheerio";
import { fetchHtml, fetchText } from "./fetch-page";
import { renderHtml } from "./render";
import { extractSignals } from "./signals";
import { ScrapeError, assertPublicHost, normalizeSiteUrl } from "./url";
import type { ScrapeResult, ScrapedPage } from "./types";

// Orchestrates a site scan: homepage first, then a handful of high-signal
// internal pages (about, services, pricing, contact, work). The output feeds
// the brand-extraction prompt; nothing here talks to the DB or Claude.
//
// Plain fetch is the fast path. When the homepage HTML is a client-rendered
// shell (almost no visible text), the scan falls back to headless-Chrome
// rendering (lib/scrape/render.ts) for the homepage AND the internal pages,
// so JS-only sites still import. If no browser is available the fallback is
// skipped and the old no_text behavior applies.

const MAX_INTERNAL_PAGES = 7; // 8 total with homepage
const MAX_INTERNAL_PAGES_RENDERED = 5; // rendering is ~5x slower per page
const MAX_CHARS_PER_PAGE = 8_000;
const MAX_CHARS_TOTAL = 40_000;
const MIN_TOTAL_TEXT = 300;
// Below this many chars of homepage text, assume a JS shell and try rendering.
const RENDER_FALLBACK_THRESHOLD = 400;
const TOTAL_BUDGET_MS = 45_000;
const CONCURRENCY = 3;
const CONCURRENCY_RENDERED = 2; // parallel tabs in the shared browser

// Best page per tier is fetched first, so one huge nav can't crowd out the
// pricing page with ten "about the team" links.
const PATH_TIERS: RegExp[] = [
  /about|story|team|who-we-are/,
  /service|product|solution|what-we-do|offer/,
  /pricing|plans|packages|rates/,
  /contact|get-in-touch|book/,
  /work|portfolio|case-stud|project/,
];

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|xml|json|css|js|ico|woff2?)$/i;

/** Strips chrome-free readable text out of one HTML document. */
function htmlToText(html: string): { title?: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  const title = $("title").first().text().trim() || undefined;
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE);
  return { title, text };
}

/** Same-origin internal links worth reading, best-first, capped. */
function pickInternalLinks(homepageHtml: string, origin: URL): URL[] {
  const $ = cheerio.load(homepageHtml);
  const seen = new Set<string>();
  const candidates: { url: URL; tier: number }[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      return;
    }
    if (url.origin !== origin.origin) return;
    url.hash = "";
    url.search = "";
    const key = url.pathname.replace(/\/$/, "");
    if (!key || key === "" || seen.has(key)) return;
    if (SKIP_EXTENSIONS.test(url.pathname)) return;
    seen.add(key);
    const path = url.pathname.toLowerCase();
    const tier = PATH_TIERS.findIndex((re) => re.test(path));
    if (tier >= 0) candidates.push({ url, tier });
  });

  // One per tier first (in tier order), then remaining by tier.
  const picked: URL[] = [];
  const byTier = new Map<number, URL[]>();
  for (const c of candidates) {
    const list = byTier.get(c.tier) ?? [];
    list.push(c.url);
    byTier.set(c.tier, list);
  }
  for (let t = 0; t < PATH_TIERS.length; t++) {
    const first = byTier.get(t)?.shift();
    if (first) picked.push(first);
  }
  for (let t = 0; t < PATH_TIERS.length && picked.length < MAX_INTERNAL_PAGES; t++) {
    for (const url of byTier.get(t) ?? []) {
      if (picked.length >= MAX_INTERNAL_PAGES) break;
      picked.push(url);
    }
  }
  return picked.slice(0, MAX_INTERNAL_PAGES);
}

/**
 * Scans a site: validates the URL (throws ScrapeError with a code the route
 * maps to an HTTP status), fetches the homepage + selected internal pages
 * within a total time budget, extracts per-page text and homepage signals.
 */
export async function scrapeSite(inputUrl: string): Promise<ScrapeResult> {
  const started = Date.now();
  const url = normalizeSiteUrl(inputUrl);
  await assertPublicHost(url.hostname); // distinguishable 400 for the entry URL

  let home = await fetchHtml(url);
  let renderedMode = false;
  // JS-shell (or bot-blocked) homepage: retry in a real browser.
  if (!home || htmlToText(home.html).text.length < RENDER_FALLBACK_THRESHOLD) {
    const rendered = await renderHtml(home?.finalUrl ?? url);
    if (
      rendered &&
      htmlToText(rendered.html).text.length >
        (home ? htmlToText(home.html).text.length : 0)
    ) {
      home = rendered;
      renderedMode = true;
    }
  }
  if (!home) {
    throw new ScrapeError("unreachable", "Couldn't reach that site.");
  }
  const origin = new URL(home.finalUrl.origin);

  const signals = await extractSignals(home.html, origin, (cssUrl) =>
    fetchText(cssUrl),
  );

  const homePage = htmlToText(home.html);
  const pages: ScrapedPage[] = [
    { url: home.finalUrl.toString(), title: homePage.title, text: homePage.text },
  ];

  // Fetch internal pages with small concurrency inside the time budget.
  // In rendered mode the homepage needed a browser, so its internal pages
  // almost certainly do too: render them directly instead of fetching twice.
  const queue = pickInternalLinks(home.html, origin).slice(
    0,
    renderedMode ? MAX_INTERNAL_PAGES_RENDERED : MAX_INTERNAL_PAGES,
  );
  const concurrency = renderedMode ? CONCURRENCY_RENDERED : CONCURRENCY;
  const results: (ScrapedPage | null)[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length) return;
      if (Date.now() - started > TOTAL_BUDGET_MS) return;
      const page = renderedMode
        ? await renderHtml(queue[i])
        : await fetchHtml(queue[i]);
      if (!page) {
        results.push(null);
        continue;
      }
      const { title, text } = htmlToText(page.html);
      results.push(text ? { url: page.finalUrl.toString(), title, text } : null);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );

  let totalChars = pages[0].text.length;
  for (const page of results) {
    if (!page) continue;
    const remaining = MAX_CHARS_TOTAL - totalChars;
    if (remaining <= 0) break;
    const text = page.text.slice(0, remaining);
    pages.push({ ...page, text });
    totalChars += text.length;
  }

  if (totalChars < MIN_TOTAL_TEXT) {
    throw new ScrapeError(
      "no_text",
      renderedMode
        ? "We couldn't read any text from this site, even in a browser. It may block automated visits."
        : "We couldn't read any text from this site. It may render entirely with JavaScript.",
    );
  }

  return { origin: origin.origin, pages, signals };
}

export { ScrapeError } from "./url";
export type { ScrapeResult, ScrapedPage, SiteSignals, ColorCandidate } from "./types";
