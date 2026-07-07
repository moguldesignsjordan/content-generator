import { NextRequest, NextResponse } from "next/server";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
  withCacheBreakpoint,
} from "@/lib/clients/anthropic";
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
  Campaign,
  CampaignBrief,
  OnboardingMessage,
  Strategy,
} from "@/lib/db/types";
import {
  CAMPAIGN_TOOLS,
  buildCampaignSystem,
  type CampaignTopicOption,
  type CreateTopicInput,
  type SelectTopicInput,
  type SuggestedOption,
  type SuggestOptionsInput,
  type UpdateBriefInput,
  type VoiceProposals,
} from "@/prompts/campaign";
import { buildBriefStateBlock } from "@/prompts/brand-voice";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";

// A chat turn is short, but give the strategist headroom for thinking.
export const maxDuration = 120;

/**
 * One campaign-interview turn. The model replies conversationally and may call
 * tools: brief updates and topic selection/creation are applied to the DB
 * here; voice updates are only RETURNED as proposals for the user to confirm
 * (the confirm card posts to /api/campaigns/apply-voice). `start_generation`
 * flips readyToGenerate so the client kicks off /api/generate.
 */
export async function POST(req: NextRequest) {
  try {
    const { campaignId, message } = (await req.json()) as {
      campaignId?: string | null;
      message?: string;
    };
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand, strategy, icps } = data;

    // Lazily create the campaign on the first message of the conversation.
    let campaign: Campaign | null = campaignId
      ? await getCampaign(campaignId)
      : null;
    if (!campaign) campaign = await createCampaign(brand.id);

    const [products, topics] = await Promise.all([
      listProducts(brand.id),
      listTopics(),
    ]);

    const history: OnboardingMessage[] = campaign.chat_state?.messages ?? [];
    // Cache the prefix through the end of the prior turn so each new message
    // only costs full price on the small bit that's actually new. Bounded to
    // the last 10 turns (mirrors /api/create/chat) so a long campaign brief
    // conversation doesn't keep growing the per-turn input/cache-read cost.
    const priorTurns: Anthropic.MessageParam[] = history.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (priorTurns.length > 0) {
      priorTurns[priorTurns.length - 1] = withCacheBreakpoint(
        priorTurns[priorTurns.length - 1],
      );
    }
    // The mutating brief-so-far rides in the latest user turn, never the
    // system prompt (which stays byte-stable so the brand prefix caches) and
    // never persisted history (nextMessages below stores the raw message).
    const briefState = buildBriefStateBlock(
      campaign.brief ?? {},
      campaign.topic_id,
    );
    const messages = [
      ...priorTurns,
      {
        role: "user" as const,
        content: `${briefState}\n\nUSER MESSAGE:\n${message.trim()}`,
      },
    ];

    const system = cacheableSystem(
      buildCampaignSystem({
        brand,
        strategy,
        primaryIcp: icps.find((i) => i.is_primary) ?? icps[0] ?? null,
        products,
        topics,
      }),
    );

    // One retry on a transient failure so a flaky turn doesn't kill the chat.
    // Reusing the same `system` array (not rebuilding the string) is what
    // lets this retry, and the forced-action/follow-up calls below, hit the
    // prompt cache instead of repricing the whole brand context each time.
    const call = () =>
      getAnthropic().messages.create({
        model: DRAFT_MODEL,
        max_tokens: 2048,
        system,
        messages,
        tools: CAMPAIGN_TOOLS,
        tool_choice: { type: "auto" },
      });

    let response;
    try {
      response = await call();
    } catch (err) {
      logError("api:/api/campaigns/chat", err);
      response = await call();
    }
    logUsage("campaigns-chat", DRAFT_MODEL, response.usage);

    // Snapshot readiness BEFORE this turn's tool calls: if the brief was
    // already complete going in and the model produces a pure-text turn (no
    // tool calls at all), that's the "let me kick this off... / let me save
    // everything..." stall loop, the model narrates action without ever
    // calling start_generation. Detected below, corrected with a forced retry.
    const briefWasReady = !!(
      campaign.brief?.goal &&
      campaign.brief?.key_message &&
      campaign.topic_id
    );

    const state: TurnState = {
      brief: campaign.brief ?? {},
      topicId: campaign.topic_id,
      proposals: null,
      options: null,
      readyToGenerate: false,
    };

    let { reply, calledAnyTool } = await applyContentBlocks(
      response.content,
      state,
      { brand, strategy, topics },
    );

    // Stall loop: brief was already ready, user is clearly continuing the
    // conversation, but the model took no action this turn. Force one.
    if (briefWasReady && !calledAnyTool && !state.readyToGenerate) {
      try {
        const forced = await getAnthropic().messages.create({
          model: FAST_MODEL,
          max_tokens: 1024,
          system,
          messages,
          tools: CAMPAIGN_TOOLS,
          tool_choice: { type: "any" },
        });
        logUsage("campaigns-chat-forced", FAST_MODEL, forced.usage);
        const forcedResult = await applyContentBlocks(forced.content, state, {
          brand,
          strategy,
          topics,
        });
        if (forcedResult.reply.trim()) reply = forcedResult.reply;
      } catch (err) {
        logError("api:/api/campaigns/chat:forced-action", err);
      }

      // The forced retry is itself just another model call, and can also
      // fail to call a tool (or throw). Rather than leave the user stuck
      // narrating with no way forward except sending another message, treat
      // "brief already complete, two turns in a row with no action" as
      // terminal: flip readiness ourselves so the client's Generate button
      // shows up regardless of what the model did.
      if (!state.readyToGenerate) {
        state.readyToGenerate = true;
        reply = "Great, the brief is set. Kicking off your draft now.";
      }
    }

    // A tool-only turn (no text block) leaves the user with nothing to react
    // to, which is why they'd have to type "okay"/"let's go" to nudge things
    // forward. Rather than a generic filler line, ask the model for a real
    // conversational follow-up: force text-only (tool_choice: none) so it
    // can't dodge into another bare tool call.
    if (!reply.trim() && !state.readyToGenerate) {
      try {
        const toolResults = response.content
          .filter((b) => b.type === "tool_use")
          .map((b) => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: "Saved.",
          }));
        const followUp = await getAnthropic().messages.create({
          model: FAST_MODEL,
          max_tokens: 512,
          system,
          messages: [
            ...messages,
            { role: "assistant" as const, content: response.content },
            { role: "user" as const, content: toolResults },
          ],
          tools: CAMPAIGN_TOOLS,
          tool_choice: { type: "none" },
        });
        logUsage("campaigns-chat-followup", FAST_MODEL, followUp.usage);
        for (const block of followUp.content) {
          if (block.type === "text") reply += block.text;
        }
      } catch (err) {
        logError("api:/api/campaigns/chat:follow-up", err);
      }
    }

    if (!reply.trim()) {
      reply = state.readyToGenerate
        ? "Great, the brief is set. Kicking off your draft now."
        : "Got it, let's keep going. What's next?";
    }
    reply = stripEmDashes(reply);

    const nextMessages: OnboardingMessage[] = [
      ...history,
      { role: "user", content: message.trim() },
      { role: "assistant", content: reply },
    ];
    await updateCampaign(campaign.id, {
      brief: state.brief,
      topic_id: state.topicId,
      chat_state: { messages: nextMessages },
      ...(state.readyToGenerate ? { status: "generating" as const } : {}),
    });

    return NextResponse.json({
      reply,
      campaignId: campaign.id,
      topicId: state.topicId,
      brief: state.brief,
      proposals: state.proposals,
      options: state.options,
      readyToGenerate: state.readyToGenerate,
    });
  } catch (err) {
    logError("api:/api/campaigns/chat", err);
    return NextResponse.json(
      { error: "Failed to process campaign turn." },
      { status: 500 },
    );
  }
}

interface TurnState {
  brief: CampaignBrief;
  topicId: string | null;
  proposals: VoiceProposals | null;
  options: SuggestedOption[] | null;
  readyToGenerate: boolean;
}

/**
 * Applies one model turn's content blocks: accumulates the text reply and
 * mutates `state` for every tool call (brief updates, topic select/create,
 * voice proposals, generation handoff). Shared by the primary turn and the
 * forced-action retry so tool effects are applied exactly once per turn.
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
        if (ctx.topics.some((t) => t.id === input.topic_id)) {
          state.topicId = input.topic_id;
        }
        break;
      }
      case "create_topic": {
        const input = block.input as CreateTopicInput;
        // A fresh brand may have no strategy or cluster yet; create the
        // starter structure instead of silently dropping the topic (which
        // dead-ended generation for new users).
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
        break;
      }
      case "propose_voice_updates": {
        state.proposals = block.input as VoiceProposals;
        break;
      }
      case "suggest_options": {
        const input = block.input as SuggestOptionsInput;
        // Drop any hallucinated topic id rather than trust it blindly, same
        // guard as select_topic; action-kind ids are free-form by design.
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
