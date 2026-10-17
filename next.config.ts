import type { NextConfig } from "next";

// Routes that can fall back to headless Chrome (lib/scrape/render.ts).
const SCRAPE_ROUTES = [
  "/api/settings/import-website",
  "/api/settings/import-products",
  "/api/competitor-references",
  "/api/create/chat",
  "/api/onboarding/research",
];

const nextConfig: NextConfig = {
  // Generating a full piece with Claude can take 30–90s; routes that call the
  // model set their own `maxDuration` (see app/api/*). Nothing global needed yet.

  // @sparticuz/chromium reads its compressed browser from bin/ at runtime, so
  // file tracing can't see it; without this Vercel ships the JS and no browser.
  outputFileTracingIncludes: Object.fromEntries(
    SCRAPE_ROUTES.map((route) => [route, ["./node_modules/@sparticuz/chromium/bin/**"]]),
  ),
};

export default nextConfig;
