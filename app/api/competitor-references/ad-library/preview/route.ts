import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSingleBrand, listCompetitorReferences } from "@/lib/db/queries";
import { adLibraryAdUrl, fetchPageAds } from "@/lib/clients/scrapecreators";
import { parseAdLibraryUrl } from "@/lib/scrape/url";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Step 1 of the Ad Library import: read an advertiser's Ad Library link, pull
// its top ads through ScrapeCreators, and return them for the user to pick
// from. Saves nothing (one paid request per preview); the picked ads go to
// POST /api/competitor-references/ad-library.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    const ref = parseAdLibraryUrl(typeof body?.url === "string" ? body.url : "");
    if (!ref) {
      return NextResponse.json(
        {
          error:
            "That isn't an advertiser's Ad Library link. Open the advertiser's page in " +
            "Ad Library (the link has view_all_page_id in it) and copy that.",
        },
        { status: 400 },
      );
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const saved = await listCompetitorReferences(brand.id);
    let ads;
    try {
      ads = await fetchPageAds(ref);
    } catch (err) {
      // fetchPageAds throws user-readable messages (missing key, failed request).
      logError("api:/api/competitor-references/ad-library/preview:fetch", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Couldn't load that page's ads." },
        { status: 502 },
      );
    }
    const savedUrls = new Set(saved.map((r) => r.source_url).filter(Boolean));
    return NextResponse.json({
      ads: ads.map((ad) => ({ ...ad, saved: savedUrls.has(adLibraryAdUrl(ad.adArchiveId)) })),
    });
  } catch (err) {
    logError("api:/api/competitor-references/ad-library/preview", err);
    return NextResponse.json({ error: "Couldn't load that page's ads." }, { status: 500 });
  }
}
