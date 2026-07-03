import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// URL validation + SSRF guard for the website importer. Every outbound fetch
// (pages, stylesheets, logo images) must pass assertPublicHost first so a
// user-supplied URL can never reach localhost, private ranges, or cloud
// metadata endpoints. Residual DNS-rebinding TOCTOU (record changes between
// this check and the fetch) is accepted for v1: single-tenant, user-initiated.

export type ScrapeErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "unreachable"
  | "not_html"
  | "no_text";

export class ScrapeError extends Error {
  code: ScrapeErrorCode;
  constructor(code: ScrapeErrorCode, message: string) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
  }
}

/** Trims, defaults to https://, and validates the user's site URL. */
export function normalizeSiteUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new ScrapeError("invalid_url", "Enter a website URL.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ScrapeError("invalid_url", "That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("invalid_url", "Only http and https URLs are supported.");
  }
  if (url.username || url.password) {
    throw new ScrapeError("invalid_url", "URLs with credentials aren't supported.");
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new ScrapeError("invalid_url", "Enter a full domain, like example.com.");
  }
  return url;
}

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // 127/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // 169.254/16 link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) // 192.168/16
  );
}

export function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) return isPrivateIpv4(addr);
  if (family === 6) {
    const lower = addr.toLowerCase();
    // IPv4-mapped (::ffff:x.x.x.x)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    // fc00::/7 unique-local, fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    return false;
  }
  return true; // not an IP literal we understand: treat as unsafe
}

/**
 * Rejects hostnames that are, or resolve to, private/reserved addresses.
 * Throws ScrapeError("blocked_host") so routes can map it to a 400.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    throw new ScrapeError("blocked_host", "That host can't be scanned.");
  }
  if (isIP(lower)) {
    if (isPrivateAddress(lower)) {
      throw new ScrapeError("blocked_host", "That host can't be scanned.");
    }
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(lower, { all: true });
  } catch {
    throw new ScrapeError("unreachable", "That domain doesn't resolve.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ScrapeError("blocked_host", "That host can't be scanned.");
  }
}
