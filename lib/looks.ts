import type { LookExample, LookExampleSource } from "@/lib/db/types";
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
