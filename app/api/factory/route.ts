import { NextRequest, NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { guardAiRoute } from "@/lib/ai-guard";
import {
  createCampaign,
  deleteCampaign,
  getBrandWithIcps,
  listBrandMemory,
  listProducts,
  updateCampaign,
} from "@/lib/db/queries";
import type { FactoryKind, FactoryState } from "@/lib/db/types";
import {
  factoryStartDate,
  loadUnitCosts,
  planCampaign,
  quotePlan,
  researchCampaign,
} from "@/lib/pipeline/campaign-factory";
import { FACTORY_KINDS } from "@/prompts/campaign-formats";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Research (web search + fetch, one Sonnet turn, up to a few resumes) plus
// planning (one Sonnet call) is a couple of minutes.
export const maxDuration = 300;

const SIZES = new Set([6, 12, 20]);
const DAY_RANGES = new Set([14, 30]);

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Only photos this app hosted (the uploads route's Supabase bucket) are
 * accepted, since the pipeline later downloads them server-side. */
function isOwnStorageUrl(value: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    return new URL(value).host === new URL(base).host;
  } catch {
    return false;
  }
}

/**
 * POST { sentence, kinds, size, days, photo_url? }: starts a factory
 * campaign and streams its phases (researching, planning, pricing), ending in
 * `done` with the campaign id. Nothing is generated here; the plan table is
 * the checkpoint before any spend on content.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Set ANTHROPIC_API_KEY in .env.local." }, { status: 503 });
  }
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sentence =
    typeof body.sentence === "string" ? stripEmDashes(body.sentence).trim().slice(0, 500) : "";
  const kinds = (Array.isArray(body.kinds) ? body.kinds : []).filter(
    (k): k is FactoryKind => typeof k === "string" && (FACTORY_KINDS as string[]).includes(k),
  );
  const size = typeof body.size === "number" && SIZES.has(body.size) ? body.size : 12;
  const days = typeof body.days === "number" && DAY_RANGES.has(body.days) ? body.days : 30;
  const photoUrl =
    typeof body.photo_url === "string" && isOwnStorageUrl(body.photo_url)
      ? body.photo_url
      : undefined;
  if (!sentence) {
    return NextResponse.json({ error: "Say what you're promoting." }, { status: 400 });
  }
  if (!kinds.length) {
    return NextResponse.json({ error: "Pick at least one kind of content." }, { status: 400 });
  }

  const data = await getBrandWithIcps(sessionUser.id);
  if (!data) {
    return NextResponse.json({ error: "No brand found" }, { status: 404 });
  }
  const { brand, icps } = data;
  const guard = await guardAiRoute("factory", { brandId: brand.id, limit: 3 });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error, outOfCredits: guard.outOfCredits ?? false, upgradeUrl: guard.upgradeUrl },
      { status: guard.status },
    );
  }

  const [products, memories] = await Promise.all([
    listProducts(brand.id).catch(() => []),
    listBrandMemory(brand.id).catch(() => []),
  ]);
  const ctx = {
    brand,
    primaryIcp: icps.find((i) => i.is_primary) ?? icps[0] ?? null,
    products,
    memories,
  };

  const campaign = await createCampaign(brand.id);
  const factory: FactoryState = {
    sentence,
    kinds: FACTORY_KINDS.filter((k) => kinds.includes(k)),
    size,
    days,
    ...(photoUrl ? { photo_url: photoUrl } : {}),
  };
  await updateCampaign(campaign.id, {
    brief: { goal: sentence, conversation_notes: sentence },
    chat_state: { factory },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseChunk(event, payload)));
        } catch {
          // client went away; the work below still finishes and saves
        }
      };
      let saved = false;
      try {
        send("phase", { phase: "researching", label: "Researching trends and competitors" });
        const research = await researchCampaign(ctx, {
          sentence,
          kinds: factory.kinds,
          today: new Date().toISOString().slice(0, 10),
        });

        send("phase", { phase: "planning", label: `Planning ${size} pieces` });
        const planned = await planCampaign(ctx, {
          sentence,
          research: research.research,
          kinds: factory.kinds,
          size,
          days,
          startDate: factoryStartDate(),
        });

        send("phase", { phase: "pricing", label: "Pricing the batch" });
        const quote = await quotePlan(planned.plan, await loadUnitCosts(brand.id));
        // A plan that's mostly about one saved product carries its photo.
        const offerSlug = planned.plan.find((i) => i.offer_slug)?.offer_slug;

        await updateCampaign(campaign.id, {
          chat_state: {
            factory: {
              ...factory,
              ...(offerSlug ? { offer_slug: offerSlug } : {}),
              research: research.research,
              plan: planned.plan,
              quote,
              planning_usd: Number((research.usd + planned.usd).toFixed(4)),
            },
          },
        });
        saved = true;
        send("done", { campaignId: campaign.id });
      } catch (err) {
        logError("api:/api/factory", err, { campaignId: campaign.id });
        if (!saved) await deleteCampaign(campaign.id).catch(() => {});
        send("error", {
          message: err instanceof Error ? err.message : "Couldn't plan the campaign. Try again.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
