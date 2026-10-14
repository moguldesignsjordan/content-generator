import "server-only";
import { logWarn } from "@/lib/log";

// Loads brand fonts for flyer composition from Google Fonts. A plain server
// fetch of the css2 API gets TrueType files (checked 2026-10), which is what
// the next/og renderer reads (it can't read woff2). Each family/weight is
// fetched once per server instance. A family Google doesn't host (a paid or
// self-hosted face) falls back to FALLBACK_FAMILY so text always renders.

export const FALLBACK_FAMILY = "Inter";

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}

const cache = new Map<string, Promise<ArrayBuffer | null>>();

function fetchGoogleFont(family: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const css = await fetch(
        `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weight}`,
      );
      if (!css.ok) return null;
      const match = (await css.text()).match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/);
      if (!match) return null;
      const file = await fetch(match[1]);
      return file.ok ? await file.arrayBuffer() : null;
    })().catch((err) => {
      logWarn("flyer:fonts", err instanceof Error ? err.message : String(err), { family });
      return null;
    });
    cache.set(key, pending);
  }
  return pending;
}

/**
 * The heading (700) and body (400) fonts for a flyer, each from the brand's
 * family when Google hosts it, else the fallback. Returns the family name the
 * layout should use for each role. An empty list (nothing loaded at all)
 * leaves the renderer on its built-in sans.
 */
export async function loadFlyerFonts(families: {
  heading: string | null;
  body: string | null;
}): Promise<{ fonts: LoadedFont[]; heading: string; body: string }> {
  const fonts: LoadedFont[] = [];
  const resolve = async (family: string | null, weight: 400 | 700): Promise<string> => {
    for (const name of [family, FALLBACK_FAMILY]) {
      if (!name) continue;
      const data = await fetchGoogleFont(name, weight);
      if (data) {
        fonts.push({ name, data, weight, style: "normal" });
        return name;
      }
    }
    return "sans-serif";
  };
  const heading = await resolve(families.heading, 700);
  const body = await resolve(families.body ?? families.heading, 400);
  return { fonts, heading, body };
}
