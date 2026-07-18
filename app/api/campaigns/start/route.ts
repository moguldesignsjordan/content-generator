import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createCampaign,
  createTopic,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  listProducts,
  listTopics,
  updateCampaign,
} from "@/lib/db/queries";
import type {
  CampaignBrief,
  ContentImageStyle,
  EmailLengthPreference,
  FunnelStage,
  VisualVibe,
} from "@/lib/db/types";
import { IMAGE_STYLE_CATALOG } from "@/lib/image-styles";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// The form-based campaign start (replaces the chat interview): one POST
// carries the whole brief. This route persists it as a campaign + topic and
// returns the ids; the client then kicks off /api/generate and/or
// /api/flyers/generate exactly like the chat's start_generation handoff did.

const LENGTHS: EmailLengthPreference[] = ["short", "standard", "long"];
const VIBES: VisualVibe[] = ["punchy", "sleek", "playful", "premium"];
const FUNNEL_STAGES: FunnelStage[] = [
  "awareness",
  "consideration",
  "decision",
  "brand",
];

interface StartCampaignBody {
  goal?: string;
  key_message?: string;
  audience_notes?: string;
  offer_slug?: string;
  angle?: string;
  constraints?: string;
  tone?: string;
  length?: string;
  include_image?: boolean;
  visual_vibe?: string;
  image_style?: string;
  topic_id?: string;
  funnel_stage?: string;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  let body: StartCampaignBody;
  try {
    body = (await req.json()) as StartCampaignBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const goal = cleanText(body.goal);
  const keyMessage = cleanText(body.key_message);
  if (!goal || !keyMessage) {
    return NextResponse.json(
      { error: "A goal and a key message are required." },
      { status: 400 },
    );
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
    const { brand, strategy } = data;

    const [products, topics] = await Promise.all([
      listProducts(brand.id),
      listTopics(),
    ]);

    // Only keep an offer slug that resolves to a real product.
    const product =
      products.find((p) => p.slug === cleanText(body.offer_slug)) ?? null;

    const brief: CampaignBrief = {
      goal,
      key_message: keyMessage,
      ...optional("audience_notes", cleanText(body.audience_notes)),
      ...(product ? { offer_slug: product.slug } : {}),
      ...optional("angle", cleanText(body.angle)),
      ...optional("constraints", cleanText(body.constraints)),
      ...optional("tone", cleanText(body.tone)),
      ...(LENGTHS.includes(body.length as EmailLengthPreference)
        ? { length: body.length as EmailLengthPreference }
        : {}),
      ...(typeof body.include_image === "boolean"
        ? { include_image: body.include_image }
        : {}),
      ...(VIBES.includes(body.visual_vibe as VisualVibe)
        ? { visual_vibe: body.visual_vibe as VisualVibe }
        : {}),
      ...(IMAGE_STYLE_CATALOG.some((s) => s.id === body.image_style)
        ? { image_style: body.image_style as ContentImageStyle }
        : {}),
    };

    // Same auto-attach the chat interview did: a selected product with a real
    // photo becomes the hero image, unless the user explicitly said no image.
    if (product?.image_url && brief.include_image !== false) {
      brief.product_photo_url = product.image_url;
      brief.include_image = true;
    }

    // Attach an existing topic when a valid one was picked; otherwise mint a
    // new one from the brief (every draft hangs off a topic).
    let topicId =
      topics.find((t) => t.id === body.topic_id)?.id ?? null;
    if (!topicId) {
      const strategyId =
        strategy?.id ?? (await ensureStrategyAndPrimaryIcp(brand.id)).strategy.id;
      const clusterId = await ensureDefaultCluster(strategyId);
      const topic = await createTopic(clusterId, {
        title: deriveTopicTitle(keyMessage, goal),
        target_keyword: "",
        intent: "",
        funnel_stage: FUNNEL_STAGES.includes(body.funnel_stage as FunnelStage)
          ? (body.funnel_stage as FunnelStage)
          : "",
        maps_to_product: product?.slug ?? "",
      });
      topicId = topic.id;
    }

    const campaign = await createCampaign(brand.id);
    await updateCampaign(campaign.id, {
      brief,
      topic_id: topicId,
      status: "generating",
    });

    return NextResponse.json({ campaignId: campaign.id, topicId });
  } catch (err) {
    logError("api:/api/campaigns/start", err);
    return NextResponse.json(
      { error: "Failed to start the campaign." },
      { status: 500 },
    );
  }
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = stripEmDashes(value.trim());
  return trimmed || undefined;
}

function optional<K extends keyof CampaignBrief>(
  key: K,
  value: string | undefined,
): Partial<CampaignBrief> {
  return value ? { [key]: value } : {};
}

/** A short, readable topic title from the key message (fallback: the goal). */
function deriveTopicTitle(keyMessage: string, goal: string): string {
  const source = keyMessage || goal;
  const firstSentence = source.split(/[.!?\n]/)[0]?.trim() || source;
  if (firstSentence.length <= 80) return firstSentence;
  const cut = firstSentence.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}
