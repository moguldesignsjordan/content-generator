import "server-only";
import { ScrapeError, assertPublicHost } from "./url";

// Safe fetchers for the website importer. Redirects are followed manually
// (capped, host re-validated per hop) so a public URL can't bounce the server
// into an internal one, and bodies are read through a hard byte cap.

const USER_AGENT =
  "Mozilla/5.0 (compatible; ContentEngineBot/1.0; brand import, user-initiated)";

const PER_FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total >= maxBytes) {
      chunks.push(chunk.subarray(0, chunk.byteLength - (total - maxBytes)));
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetches one URL with manual, re-validated redirects. Returns the final
 * response, or null on any failure (timeout, HTTP error, too many hops).
 * Blocked hosts mid-redirect also return null; callers validate the INITIAL
 * host themselves when they want a distinguishable error.
 */
async function fetchWithGuards(
  url: URL,
  accept: string,
): Promise<{ finalUrl: URL; res: Response } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublicHost(current.hostname);
    } catch {
      return null;
    }
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      res.body?.cancel().catch(() => {});
      if (!loc) return null;
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return null;
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      current = next;
      continue;
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    return { finalUrl: current, res };
  }
  return null;
}

/** Fetches an HTML page. Null on failure or non-HTML content. */
export async function fetchHtml(
  url: URL,
  opts: { maxBytes?: number } = {},
): Promise<{ finalUrl: URL; html: string } | null> {
  const out = await fetchWithGuards(url, "text/html,application/xhtml+xml");
  if (!out) return null;
  const ct = out.res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    out.res.body?.cancel().catch(() => {});
    return null;
  }
  const buf = await readCapped(out.res, opts.maxBytes ?? 1_500_000);
  return { finalUrl: out.finalUrl, html: buf.toString("utf-8") };
}

/** Fetches a text asset (stylesheets). Null on failure. */
export async function fetchText(
  url: URL,
  opts: { maxBytes?: number } = {},
): Promise<string | null> {
  const out = await fetchWithGuards(url, "text/css,text/*");
  if (!out) return null;
  const buf = await readCapped(out.res, opts.maxBytes ?? 300_000);
  return buf.toString("utf-8");
}

/** Fetches a small binary asset (logo images) with a content-type allowlist. */
export async function fetchBinary(
  url: URL,
  opts: { allowedTypes: string[]; maxBytes: number },
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const out = await fetchWithGuards(url, "image/*");
  if (!out) return null;
  const ct = (out.res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!opts.allowedTypes.includes(ct)) {
    out.res.body?.cancel().catch(() => {});
    return null;
  }
  const declared = Number(out.res.headers.get("content-length") ?? 0);
  if (declared > opts.maxBytes) {
    out.res.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await readCapped(out.res, opts.maxBytes);
  return { bytes, contentType: ct };
}

export { ScrapeError };
