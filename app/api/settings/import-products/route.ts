import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DRAFT_MODEL, getAnthropic, isAnthropicConfigured, logUsage } from "@/lib/clients/anthropic";
import { getBrandWithIcps } from "@/lib/db/queries";
import type { ProposedProduct } from "@/lib/db/types";
import { ScrapeError, scrapeSite } from "@/lib/scrape";
import { addShareImages, scrapeProducts } from "@/lib/scrape/products";
import {
  IMPORT_TOOL,
  buildImportMessages,
  cleanImportedProducts,
  type ImportToolInput,
} from "@/prompts/import-website";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Product scan (~45s budget), plus a page scan and one Claude call when the
// site has no structured product data.
export const maxDuration = 300;

const BodySchema = z.object({ url: z.string().min(4).max(2048).optional() });

/**
 * POST { url? }: the site's products as PROPOSALS (name, description, price,
 * link, photo), from the brand's saved website unless a URL is given. Zero
 * DB writes: the owner ticks what to keep and saves through
 * /api/settings/products, which copies each photo into our storage.
 */
export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  }
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const data = await getBrandWithIcps(sessionUser.id);
    if (!data) return NextResponse.json({ error: "No brand found" }, { status: 404 });

    const url = parsed.data.url?.trim() || data.brand.visual_identity?.footer?.website?.trim();
    if (!url) {
      return NextResponse.json({ error: "Add your website first, or paste its link." }, { status: 400 });
    }

    const found = await scrapeProducts(url);
    let products: ProposedProduct[] = found.products;
    // Service sites rarely carry product data: read the pages instead.
    if (!products.length && isAnthropicConfigured()) {
      const scrape = await scrapeSite(url);
      const { system, user } = buildImportMessages(scrape);
      const response = await getAnthropic().messages.create({
        model: DRAFT_MODEL,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: user }],
        tools: [IMPORT_TOOL],
        tool_choice: { type: "tool", name: IMPORT_TOOL.name },
      });
      logUsage("import-products", DRAFT_MODEL, response.usage, { brandId: data.brand.id });
      const tu = response.content.find((b) => b.type === "tool_use");
      products = await addShareImages(
        cleanImportedProducts(tu?.type === "tool_use" ? (tu.input as ImportToolInput).products : []),
        scrape.origin,
      );
    }

    return NextResponse.json({ products, source_url: found.origin });
  } catch (err) {
    if (err instanceof ScrapeError) {
      const status = err.code === "invalid_url" || err.code === "blocked_host" ? 400 : 502;
      return NextResponse.json(
        { error: err.code === "no_text" ? "We couldn't read any products from this site." : err.message },
        { status: err.code === "no_text" ? 422 : status },
      );
    }
    logError("api:/api/settings/import-products", err);
    return NextResponse.json({ error: "Couldn't read the products. Try again." }, { status: 500 });
  }
}
