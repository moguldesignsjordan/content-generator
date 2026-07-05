import { NextRequest, NextResponse } from "next/server";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  cacheableSystem,
  getAnthropic,
  isAnthropicConfigured,
  withCacheBreakpoint,
} from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createCampaign,
  createTopic,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  getCampaign,
  listProducts,
  listTopics,
  updateCampaign,
} from "@/lib/db/queries";
import type {
  Brand,
  CampaignBrief,
  FunnelStage,
  OnboardingMessage,
  Product,
  Strategy,
} from "@/lib/db/types";
import {
  CREATE_TOOLS,
  buildCreateAgentSystem,
  type CampaignTopicOption,
  type CreateTopicInput,
  type SelectTopicInput,
  type SuggestedOption,
  type SuggestOptionsInput,
  type UpdateBriefInput,
} from "@/prompts/create-agent";
import { stripEmDashes } from "@/lib/text";

// A turn is short, but give the model headroom to think + write a follow-up.
export const maxDuration = 120;

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * The display projection of the brief rendered as editable rows in the UI.
 * Everything the card needs is resolved here (offer name from the slug, the
 * funnel stage, the CTA label) so the client just renders strings.
 */
export interface CreateBriefCard {
  topicTitle: string | null;
  audience: string | null;
  goal: string | null;
  keyMessage: string | null;
  angle: string | null;
  offerName: string | null;
  offerPrice: string | null;
  funnelStage: FunnelStage | null;
  ctaLabel: string | null;
}

interface TurnState {
  brief: CampaignBrief;
  topicId: string | null;
  topicTitle: string | null;
  funnelStage: FunnelStage | null;
  options: SuggestedOption[] | null;
  readyToGenerate: boolean;
}

/**
 * One create-agent turn. History is held client-side (sent each turn, like the
 * assistant chat); the campaign row is the brief holder only, so generation can
 * read it back via loadCampaignBrief with zero pipeline changes. Tools mutate
 * `state`; `start_generation` flips readyToGenerate so the client POSTs
 * /api/generate and opens the draft review page.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isSupabaseConfigured() || !isAnthropicConfigured()) {
      return NextResponse.json(
        { error: "Missing configuration. Set SUPABASE_* and ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }

    const { message, history, campaignId } = (await req.json()) as {
      message?: string;
      history?: ChatMsg[];
      campaignId?: string | null;
    };
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand, strategy, icps } = data;
    const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;

    // The campaign row holds the brief across turns (history lives on the
    // client). Load it if the client passed an id, otherwise create one.
    let campaign = campaignId ? await getCampaign(campaignId) : null;
    if (!campaign) campaign = await createCampaign(brand.id);

    const [products, topics] = await Promise.all([
      listProducts(brand.id),
      listTopics(),
    ]);

    const system = cacheableSystem(
      buildCreateAgentSystem({
        brand,
        strategy,
        primaryIcp,
        products,
        topics,
        brief: campaign.brief ?? {},
        topicId: campaign.topic_id,
      }),
    );

    // Cache the prefix through the end of the prior turn so each new message
    // only pays full price on the small bit that's actually new.
    const priorTurns: Anthropic.MessageParam[] = (history ?? [])
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
    if (priorTurns.length > 0) {
      priorTurns[priorTurns.length - 1] = withCacheBreakpoint(
        priorTurns[priorTurns.length - 1],
      );
    }
    const messages: Anthropic.MessageParam[] = [
      ...priorTurns,
      { role: "user", content: message.trim() },
    ];

    // One retry on a transient failure. Reusing the same `system` array (not
    // rebuilding the string) is what keeps this retry and the follow-up calls
    // below cache-hot.
    const call = () =>
      getAnthropic().messages.create({
        model: DRAFT_MODEL,
        max_tokens: 1024,
        system,
        messages,
        tools: CREATE_TOOLS,
        tool_choice: { type: "auto" },
      });

    let response;
    try {
      response = await call();
    } catch (err) {
      console.error("[create chat] failed, retrying once:", err);
      response = await call();
    }

    const state: TurnState = {
      brief: campaign.brief ?? {},
      topicId: campaign.topic_id,
      // Seed the card's topic/CTA rows from the attached topic so they show
      // immediately on turns that don't re-select.
      ...topicContextFor(campaign.topic_id, topics),
      options: null,
      readyToGenerate: false,
    };

    let { reply, calledAnyTool } = await applyContentBlocks(
      response.content,
      state,
      { brand, strategy, topics },
    );

    // Stall guard: the brief was already ready going in and the model took no
    // action this turn (the "let me kick this off..." narration loop). Force
    // one tool call so we actually hand off.
    const briefWasReady = !!(
      state.brief.goal &&
      state.brief.key_message &&
      state.topicId
    );
    if (briefWasReady && !calledAnyTool && !state.readyToGenerate) {
      try {
        const forced = await getAnthropic().messages.create({
          model: DRAFT_MODEL,
          max_tokens: 1024,
          system,
          messages,
          tools: CREATE_TOOLS,
          tool_choice: { type: "any" },
        });
        const forcedResult = await applyContentBlocks(forced.content, state, {
          brand,
          strategy,
          topics,
        });
        if (forcedResult.reply.trim()) reply = forcedResult.reply;
      } catch (err) {
        console.error("[create chat] forced-action retry failed:", err);
      }
    }

    // A tool-only turn leaves the user with nothing to react to. Force a real
    // conversational follow-up (tool_choice: none) instead of a filler line.
    if (!reply.trim()) {
      try {
        const toolResults = response.content
          .filter((b) => b.type === "tool_use")
          .map((b) => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: "Saved.",
          }));
        const followUp = await getAnthropic().messages.create({
          model: DRAFT_MODEL,
          max_tokens: 512,
          system,
          messages: [
            ...messages,
            { role: "assistant", content: response.content },
            { role: "user", content: toolResults },
          ],
          tools: CREATE_TOOLS,
          tool_choice: { type: "none" },
        });
        for (const block of followUp.content) {
          if (block.type === "text") reply += block.text;
        }
      } catch (err) {
        console.error("[create chat] follow-up call failed:", err);
      }
    }

    if (!reply.trim()) {
      reply = state.readyToGenerate
        ? "The brief is set. Generating your draft now."
        : "Got it. What's the one thing this email needs to land?";
    }
    reply = stripEmDashes(reply);

    // Persist only the brief + topic (history is client-side). Mark the
    // campaign "generating" once we hand off so its state reflects reality.
    await updateCampaign(campaign.id, {
      brief: state.brief,
      topic_id: state.topicId,
      ...(state.readyToGenerate ? { status: "generating" as const } : {}),
    });

    const offer =
      state.brief.offer_slug
        ? (products.find((p) => p.slug === state.brief.offer_slug) ?? null)
        : null;

    const card: CreateBriefCard = {
      topicTitle: state.topicTitle,
      audience: state.brief.audience_notes ?? primaryIcp?.label ?? null,
      goal: state.brief.goal ?? null,
      keyMessage: state.brief.key_message ?? null,
      angle: state.brief.angle ?? null,
      offerName: offer?.name ?? null,
      offerPrice: offer?.price_point ?? null,
      funnelStage: state.funnelStage,
      ctaLabel: resolveCtaLabel(brand, strategy, state.funnelStage),
    };

    return NextResponse.json({
      reply,
      campaignId: campaign.id,
      topicId: state.topicId,
      brief: state.brief,
      card,
      options: state.options,
      readyToGenerate: state.readyToGenerate,
    });
  } catch (err) {
    console.error("[create chat] error", err);
    return NextResponse.json(
      { error: "The create agent hit a snag. Try again." },
      { status: 500 },
    );
  }
}

/**
 * Applies one model turn's content blocks: accumulates the text reply and
 * mutates `state` for every tool call (brief updates, topic select/create,
 * option suggestions, generation handoff). Shared by the primary turn and the
 * forced-action retry so tool effects apply exactly once per turn.
 */
async function applyContentBlocks(
  content: Anthropic.Messages.ContentBlock[],
  state: TurnState,
  ctx: {
    brand: Brand;
    strategy: Strategy | null;
    topics: CampaignTopicOption[];
  },
): Promise<{ reply: string; calledAnyTool: boolean }> {
  let reply = "";
  let calledAnyTool = false;

  for (const block of content) {
    if (block.type === "text") {
      reply += block.text;
      continue;
    }
    if (block.type !== "tool_use") continue;
    calledAnyTool = true;

    switch (block.name) {
      case "update_brief": {
        const input = block.input as UpdateBriefInput;
        state.brief = mergeBrief(state.brief, input);
        break;
      }
      case "select_topic": {
        const input = block.input as SelectTopicInput;
        const found = ctx.topics.find((t) => t.id === input.topic_id);
        if (found) {
          state.topicId = found.id;
          state.topicTitle = found.title;
          state.funnelStage = (found.funnel_stage as FunnelStage) ?? null;
        }
        break;
      }
      case "create_topic": {
        const input = block.input as CreateTopicInput;
        // A fresh brand may have no strategy or cluster yet; create the starter
        // structure instead of silently dropping the topic.
        const strategyId =
          ctx.strategy?.id ??
          (await ensureStrategyAndPrimaryIcp(ctx.brand.id)).strategy.id;
        const clusterId = await ensureDefaultCluster(strategyId);
        const topic = await createTopic(clusterId, {
          title: input.title,
          target_keyword: input.target_keyword ?? "",
          intent: input.intent ?? "",
          funnel_stage: input.funnel_stage ?? "",
          maps_to_product: state.brief.offer_slug ?? "",
        });
        state.topicId = topic.id;
        state.topicTitle = topic.title;
        state.funnelStage = topic.funnel_stage;
        break;
      }
      case "suggest_options": {
        const input = block.input as SuggestOptionsInput;
        // Drop hallucinated topic ids; action-kind ids are free-form by design.
        state.options = (input.options ?? []).filter(
          (o) => o.kind !== "topic" || ctx.topics.some((t) => t.id === o.id),
        );
        break;
      }
      case "start_generation": {
        // Only honor the handoff when a topic is actually attached.
        if (state.topicId) state.readyToGenerate = true;
        break;
      }
    }
  }

  return { reply, calledAnyTool };
}

/** Merges only the fields the model actually passed onto the stored brief. */
function mergeBrief(current: CampaignBrief, input: UpdateBriefInput): CampaignBrief {
  const next = { ...current };
  for (const key of [
    "goal",
    "audience_notes",
    "key_message",
    "offer_slug",
    "angle",
    "constraints",
  ] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      next[key] = stripEmDashes(value.trim());
    }
  }
  return next;
}

/** Resolves a topic's title + funnel stage from the catalog (for the card). */
function topicContextFor(
  topicId: string | null,
  topics: CampaignTopicOption[],
): { topicTitle: string | null; funnelStage: FunnelStage | null } {
  if (!topicId) return { topicTitle: null, funnelStage: null };
  const found = topics.find((t) => t.id === topicId);
  if (!found) return { topicTitle: null, funnelStage: null };
  return {
    topicTitle: found.title,
    funnelStage: (found.funnel_stage as FunnelStage) ?? null,
  };
}

/**
 * Inline CTA resolution (funnel_stage → strategy cta_type → brand cta_library),
 * mirroring prompts/generate-email.ts resolveCta without needing a full
 * TopicContext. Drives the "Goal" row's CTA hint on the brief card.
 */
function resolveCtaLabel(
  brand: Brand,
  strategy: Strategy | null,
  stage: FunnelStage | null,
): string | null {
  if (!stage) return null;
  const ctaType = strategy?.funnel_definition?.[stage]?.cta_type ?? null;
  if (!ctaType) return null;
  return brand.voice_profile?.cta_library?.[ctaType] ?? null;
}
