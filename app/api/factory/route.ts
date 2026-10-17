import { NextRequest, NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { guardAiRoute } from "@/lib/ai-guard";
import {
  createCampaign,
  deleteCampaign,
  getBrandWithIcps,
  getCampaign,
  getCompetitorReference,
  getDesignLook,
  listBrandMemory,
  listProducts,
  updateCampaign,
} from "@/lib/db/queries";
import type {
  CompetitorReference,
  FactoryKind,
  FactoryProduct,
  FactoryState,
  PerProduct,
  PieceInputs,
  Product,
  StyleChoice,
} from "@/lib/db/types";
import { MAX_PIECE_PHOTOS } from "@/lib/db/types";
import { compactInputs, followedStyleImages } from "@/lib/inputs";
import {
  factoryStartDate,
  loadUnitCosts,
  planCampaign,
  quotePlan,
  researchCampaign,
} from "@/lib/pipeline/campaign-factory";
import { FACTORY_KINDS } from "@/prompts/campaign-formats";
import { cleanProductNames } from "@/lib/create-questions";
import { planProductSlots } from "@/lib/factory/plan";
import { stripEmDashes } from "@/lib/text";
import { cleanClientBrand, cleanColors, cleanReferenceUrls } from "@/lib/looks";
import { extractLookProfile } from "@/lib/pipeline/extract-look";
import { logError } from "@/lib/log";
import { publicError } from "@/lib/provider-outage";
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

function stringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The products a one-design-per-product plan covers, from untrusted input:
 * names cleaned, and a slug kept only when it's one of this brand's. */
function cleanFactoryProducts(raw: unknown, products: Product[]): FactoryProduct[] {
  const items = (Array.isArray(raw) ? raw : []).filter(
    (p): p is { name?: unknown; slug?: unknown } => Boolean(p) && typeof p === "object",
  );
  const names = cleanProductNames(items.map((p) => p.name));
  return names.map((name) => {
    const slug = items.find((p) => typeof p.name === "string" && p.name.trim() === name)?.slug;
    const saved = typeof slug === "string" ? products.find((p) => p.slug === slug) : undefined;
    return saved ? { name, slug: saved.slug } : { name };
  });
}

/**
 * The chat's inputs, from untrusted input. Photos and style images must be
 * our own uploads (or a product's stored photo), since the pipeline fetches
 * them server-side; the look and the competitor ads must be this brand's.
 * Also returns the first competitor ad, which the planner reads.
 */
async function cleanInputs(
  raw: unknown,
  brandId: string,
  products: Product[],
): Promise<{ inputs: PieceInputs; competitorRef: CompetitorReference | null }> {
  const value = (raw ?? {}) as Record<string, unknown>;
  const productPhotos = new Set(products.map((p) => p.image_url).filter(Boolean));
  const photos = stringList(value.photos)
    .filter((url) => isOwnStorageUrl(url) || productPhotos.has(url))
    .slice(0, MAX_PIECE_PHOTOS);

  const rawImages = (value.style_images ?? {}) as Record<string, unknown>;
  const styleUrls = cleanReferenceUrls(rawImages.urls, isOwnStorageUrl);
  const rawStyle = (value.style ?? {}) as Record<string, unknown>;
  let style: StyleChoice | undefined;
  if (rawStyle.kind === "our" || rawStyle.kind === "none" || rawStyle.kind === "images") {
    style = { kind: rawStyle.kind };
  } else if (
    rawStyle.kind === "look" &&
    typeof rawStyle.look_id === "string" &&
    (await getDesignLook(rawStyle.look_id, brandId))
  ) {
    style = { kind: "look", look_id: rawStyle.look_id };
  }

  const refs: CompetitorReference[] = [];
  for (const id of stringList(value.competitor_reference_ids).slice(0, 10)) {
    const ref = await getCompetitorReference(id).catch(() => null);
    if (ref?.brand_id === brandId) refs.push(ref);
  }

  return {
    inputs: compactInputs({
      photos,
      ...(styleUrls.length
        ? { style_images: { urls: styleUrls, from: rawImages.from === "competitor" ? "competitor" : "upload" } }
        : {}),
      style,
      competitor_reference_ids: refs.map((r) => r.id),
    }),
    competitorRef: refs[0] ?? null,
  };
}

/**
 * POST { sentence, kinds, size, days, inputs?, client_brand?, colors?, research?,
 * campaign_id?, products?, split?, per_product? }: starts a factory campaign
 * (one design per product when split is "each") and streams its phases
 * (researching only when the owner said yes, planning, pricing), ending in
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
  const requestedSize = typeof body.size === "number" && SIZES.has(body.size) ? body.size : 12;
  const days = typeof body.days === "number" && DAY_RANGES.has(body.days) ? body.days : 30;
  const clientBrand = cleanClientBrand(body.client_brand, isOwnStorageUrl);
  const colors = cleanColors(body.colors, 3);
  // Web research costs real money and time, so it only runs when asked.
  const doResearch = body.research === true;
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
  const { inputs, competitorRef } = await cleanInputs(body.inputs, brand.id, products);
  // One design per product: the size is products x per product, capped.
  const split = body.split === "each" || body.split === "together" ? body.split : undefined;
  const perProduct: PerProduct =
    body.per_product === 3 || body.per_product === 6 ? body.per_product : 1;
  const planProducts = split === "each" ? cleanFactoryProducts(body.products, products) : [];
  const slots = planProductSlots(
    planProducts.map((p) => p.name),
    perProduct,
    FACTORY_KINDS.filter((k) => kinds.includes(k)),
  );
  const size = slots.length ? slots.reduce((sum, s) => sum + s.total, 0) : requestedSize;
  const ctx = {
    brand,
    primaryIcp: icps.find((i) => i.is_primary) ?? icps[0] ?? null,
    products,
    memories,
  };

  // A campaign planned from the chat reuses that chat's row so it doesn't
  // leave an empty one behind; on failure its chat is put back as it was.
  const requested =
    typeof body.campaign_id === "string" ? await getCampaign(body.campaign_id) : null;
  const reused =
    requested && requested.brand_id === brand.id && !requested.chat_state?.factory
      ? requested
      : null;
  const campaign = reused ?? (await createCampaign(brand.id));
  const factory: FactoryState = {
    sentence,
    kinds: FACTORY_KINDS.filter((k) => kinds.includes(k)),
    size,
    days,
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(clientBrand ? { client_brand: clientBrand } : {}),
    ...(colors.length ? { colors } : {}),
    ...(planProducts.length ? { products: planProducts, split, per_product: perProduct } : {}),
  };
  // The chat's transcript stays on its row, so what was said (and attached)
  // can still be looked at after the campaign takes it over.
  const messages = reused?.chat_state?.messages;
  await updateCampaign(campaign.id, {
    brief: { goal: sentence, conversation_notes: sentence },
    chat_state: { ...(messages ? { messages } : {}), factory },
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
      // The style images are read once here, alongside planning, so every
      // post and ad the launch makes shares the profile. Never throws: null
      // just means the images alone steer the renders.
      const styleImages = followedStyleImages(inputs);
      const profileRead = styleImages
        ? extractLookProfile(
            styleImages.urls.map((url) => ({ url, source: "upload" as const })),
            brand.id,
          )
        : Promise.resolve(null);
      try {
        let research: Awaited<ReturnType<typeof researchCampaign>> | null = null;
        if (doResearch) {
          send("phase", { phase: "researching", label: "Researching trends and competitors" });
          research = await researchCampaign(ctx, {
            sentence,
            kinds: factory.kinds,
            today: new Date().toISOString().slice(0, 10),
          });
        }

        send("phase", { phase: "planning", label: `Planning ${size} pieces` });
        const planned = await planCampaign(ctx, {
          sentence,
          research: research?.research,
          kinds: factory.kinds,
          size,
          days,
          startDate: factoryStartDate(),
          competitorRef,
          photoUrls: inputs.photos ?? [],
          ...(planProducts.length ? { products: planProducts, perProduct } : {}),
        });

        send("phase", { phase: "pricing", label: "Pricing the batch" });
        const quote = await quotePlan(planned.plan, await loadUnitCosts(brand.id));
        // A plan that's mostly about one saved product carries its photo.
        const offerSlug = planned.plan.find((i) => i.offer_slug)?.offer_slug;
        const referenceProfile = await profileRead;

        await updateCampaign(campaign.id, {
          chat_state: {
            ...(messages ? { messages } : {}),
            factory: {
              ...factory,
              ...(offerSlug ? { offer_slug: offerSlug } : {}),
              ...(research ? { research: research.research } : {}),
              ...(referenceProfile ? { reference_profile: referenceProfile } : {}),
              ...(planned.flyerStyle ? { flyer_style: planned.flyerStyle } : {}),
              plan: planned.plan,
              quote,
              planning_usd: Number(((research?.usd ?? 0) + planned.usd).toFixed(4)),
            },
          },
        });
        saved = true;
        send("done", { campaignId: campaign.id });
      } catch (err) {
        logError("api:/api/factory", err, { campaignId: campaign.id });
        if (!saved) {
          await (reused
            ? updateCampaign(campaign.id, {
                brief: reused.brief,
                chat_state: reused.chat_state,
              })
            : deleteCampaign(campaign.id)
          ).catch(() => {});
        }
        send("error", {
          message: publicError(err, "Couldn't plan the campaign. Try again.").message,
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
