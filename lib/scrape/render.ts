import "server-only";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { isPrivateAddress } from "./url";

// JavaScript rendering fallback: when a site's server HTML is an empty shell
// (client-rendered SPA), the scraper re-loads it in headless Chrome and reads
// the hydrated DOM. puppeteer-core drives an ALREADY-INSTALLED browser, so
// there's no bundled-Chromium download. Vercel functions have no system
// Chrome, so there the browser comes from @sparticuz/chromium instead.
// Anywhere else without a browser, rendering quietly degrades to the
// plain-fetch behavior.

const CHROME_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const NAV_TIMEOUT_MS = 15_000;
const SETTLE_MS = 800;

function findChrome(): string | null {
  for (const p of CHROME_PATHS) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Whether a JS-rendering browser is available in this environment. */
export function isRenderAvailable(): boolean {
  return findChrome() !== null || Boolean(process.env.VERCEL);
}

async function launchBrowser(): Promise<Browser | null> {
  const executablePath = findChrome();
  if (executablePath) {
    return puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--disable-gpu", "--disable-dev-shm-usage"],
    });
  }
  if (!process.env.VERCEL) return null;
  // Imported lazily: it's a Linux-only binary that local dev never needs.
  const { default: chromium } = await import("@sparticuz/chromium");
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: "shell",
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
  });
}

// One shared browser per process; pages are opened/closed per render. The
// promise resets on launch failure so a transient error doesn't wedge it.
let browserPromise: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (!browserPromise) browserPromise = launchBrowser();
  try {
    const browser = await browserPromise;
    if (!browser?.connected) throw new Error("browser unavailable");
    return browser;
  } catch {
    browserPromise = null;
    return null;
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) !== 0 && isPrivateAddress(host))
  );
}

/**
 * Loads a page in headless Chrome and returns the hydrated DOM as HTML.
 * The caller must have already validated the target host (assertPublicHost);
 * request interception additionally blocks subresource calls to obviously
 * private hosts and non-http schemes, and drops images/media/fonts for speed.
 * Returns null when no browser is available or the page never produces a DOM.
 */
export async function renderHtml(
  url: URL,
): Promise<{ finalUrl: URL; html: string } | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if (
          (u.protocol !== "http:" && u.protocol !== "https:") ||
          isBlockedHost(u.hostname)
        ) {
          return void req.abort();
        }
        const type = req.resourceType();
        if (type === "image" || type === "media" || type === "font") {
          return void req.abort();
        }
        return void req.continue();
      } catch {
        return void req.abort().catch(() => {});
      }
    });

    try {
      await page.goto(url.toString(), {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
    } catch {
      // Timeout is common on chatty SPAs; the DOM is usually rendered anyway,
      // so fall through and take whatever content exists. A hard navigation
      // failure just yields an empty shell the caller's text check rejects.
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const html = await page.content();
    let finalUrl: URL;
    try {
      finalUrl = new URL(page.url());
    } catch {
      finalUrl = url;
    }
    if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") {
      return null;
    }
    return { finalUrl, html };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}
