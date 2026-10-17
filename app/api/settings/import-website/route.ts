import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { getBrandWithIcps } from "@/lib/db/queries";
import { ScrapeError } from "@/lib/scrape";
import { ImportEmptyError, importWebsite } from "@/lib/pipeline/import-website";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Scrape (~45s budget) + one Claude call with a large input can be slow.
export const maxDuration = 300;

const BodySchema = z.object({ url: z.string().min(4).max(2048) });

/**
 * POST { url }: scrape the site, extract a brand PROPOSAL with Claude, and
 * return it. Performs ZERO database writes; the review UI saves selected
 * sections through the existing settings PATCH routes.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  }

  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const data = await getBrandWithIcps(sessionUser.id);
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }

    const { proposal } = await importWebsite(parsed.data.url, {
      brandId: data.brand.id,
      brandName: data.brand.name,
    });
    return NextResponse.json({ proposal });
  } catch (err) {
    if (err instanceof ImportEmptyError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof ScrapeError) {
      const status =
        err.code === "invalid_url" || err.code === "blocked_host"
          ? 400
          : err.code === "no_text"
            ? 422
            : 502;
      const message =
        err.code === "no_text"
          ? "We couldn't read any text from this site. It may render entirely with JavaScript. You can fill your profile manually in Settings."
          : err.message;
      return NextResponse.json({ error: message }, { status });
    }
    logError("api:/api/settings/import-website", err);
    return NextResponse.json(
      { error: "Import failed. Try again." },
      { status: 500 },
    );
  }
}
