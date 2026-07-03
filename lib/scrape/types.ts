// Shared shapes for the website scraper. No "server-only" here: these are
// plain types, and prompt/route files import them alongside client-safe types.

export interface ScrapedPage {
  url: string;
  title?: string;
  text: string;
}

export interface ColorCandidate {
  hex: string; // normalized 6-digit lowercase, e.g. "#1a2b3c"
  count: number;
  /** css-var hits are the strongest brand-color signal. */
  source: "css-var" | "css" | "inline";
}

export interface SiteSignals {
  site_name?: string;
  meta_description?: string;
  og_image?: string;
  /** Absolute URLs, best-first. */
  logo_candidates: string[];
  /** rel=icon / apple-touch-icon, absolute URLs. */
  icon_candidates: string[];
  color_candidates: ColorCandidate[];
  /** font-family stacks by frequency, generic-only stacks filtered. */
  font_candidates: string[];
  emails: string[];
  social: {
    linkedin?: string;
    twitter?: string;
    instagram?: string;
    youtube?: string;
  };
}

export interface ScrapeResult {
  /** Origin of the site after redirects, e.g. "https://example.com". */
  origin: string;
  pages: ScrapedPage[];
  signals: SiteSignals;
}
