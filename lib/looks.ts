import { MAX_FLYER_REFERENCES, type ClientBrand, type LookExample, type LookExampleSource } from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";

// Validation for design looks coming from the client. Pure, so the API routes
// share it and it's unit-tested. Every example must already be hosted on our
// own storage: uploads, re-hosted Ad Library images, library references, and
// imported URLs all land there first, so a look can never point the image
// model at an arbitrary outside URL.

export const MAX_EXAMPLES = 6;
const SOURCES: LookExampleSource[] = ["upload", "library", "ad_library", "url"];

export function cleanLookName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = stripEmDashes(value).trim().slice(0, 60);
  return name || null;
}

export function cleanExamples(value: unknown, storageHost: string | null): LookExample[] | null {
  if (!Array.isArray(value) || !storageHost) return null;
  const out: LookExample[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, MAX_EXAMPLES)) {
    const ex = (raw ?? {}) as Record<string, unknown>;
    if (typeof ex.url !== "string" || seen.has(ex.url)) continue;
    let host: string;
    try {
      const u = new URL(ex.url);
      if (u.protocol !== "https:") continue;
      host = u.host;
    } catch {
      continue;
    }
    if (host !== storageHost) continue;
    const source = SOURCES.includes(ex.source as LookExampleSource)
      ? (ex.source as LookExampleSource)
      : "upload";
    seen.add(ex.url);
    out.push({
      url: ex.url,
      source,
      ...(typeof ex.ref_id === "string" && ex.ref_id ? { ref_id: ex.ref_id } : {}),
    });
  }
  return out.length ? out : null;
}

/** Our Supabase project's host, the only place example images may live. */
export function storageHostFromEnv(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Attached designs for a flyer to match: strings `allowed` accepts,
 * trimmed, deduped, and capped. */
export function cleanReferenceUrls(value: unknown, allowed: (url: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const urls = value
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(allowed);
  return Array.from(new Set(urls)).slice(0, MAX_FLYER_REFERENCES);
}

/** The business a flyer is for, from untrusted input; null without a name.
 * Colors must be #RRGGBB, and the logo survives only when `allowed` accepts
 * its URL. */
export function cleanClientBrand(value: unknown, allowed: (url: string) => boolean): ClientBrand | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? stripEmDashes(raw.name).trim().slice(0, 80) : "";
  if (!name) return null;
  const colors = (Array.isArray(raw.colors) ? raw.colors : [])
    .filter((c): c is string => typeof c === "string" && HEX_COLOR.test(c.trim()))
    .map((c) => c.trim())
    .slice(0, 4);
  const logo = typeof raw.logo_url === "string" ? raw.logo_url.trim() : "";
  return {
    name,
    ...(colors.length ? { colors } : {}),
    ...(logo && allowed(logo) ? { logo_url: logo } : {}),
  };
}
