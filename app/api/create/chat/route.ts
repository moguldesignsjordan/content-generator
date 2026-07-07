import { NextRequest, NextResponse } from "next/server";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  cacheableSystem,
  getAnthropic,
  isAnthropicConfigured,
  logUsage,
  withCacheBreakpoint,
} from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  addBrandMemory,
  createCampaign,
  createDraftShell,
  createTopic,
  deleteBrandMemory,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBlogDraftFromEmail,
  getBrandWithIcps,
  getCampaign,
  getDraftForReview,
  getDraftWithJobContext,
  getTopicContext,
  listBrandMemory,
  listDrafts,
  listProducts,
  listTopics,
  updateCampaign,
} from "@/lib/db/queries";
import type { Brand, CampaignBrief, FunnelStage, Strategy } from "@/lib/db/types";
import {
  CREATE_TOOLS,
  buildCreateAgentSystem,
  type CampaignTopicOption,
  type CreateBlogFromEmailInput,
  type CreateTopicInput,
  type ForgetInput,
  type GenerateContentInput,
  type GetContentInput,
  type ListRecentContentInput,
  type RememberInput,
  type SelectTopicInput,
  type SuggestedOption,
  type SuggestOptionsInput,
  type UpdateBriefInput,
} from "@/prompts/create-agent";
import { buildBriefStateBlock } from "@/prompts/brand-voice";
import { buildBriefCard, topicContextFor, type CreateBriefCard } from "@/lib/brief-card";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";

// A turn can chain several tool round-trips (brief -> topic -> generate); give
// it real headroom rather than the old single-call budget.
export const maxDuration = 300;

// Real chains are short (update_brief -> select_topic/create_topic ->
// generate_content is 2-3 round-trips); 8 gives slack for a clarify-then-
// continue turn without letting a confused model loop indefinitely.
const MAX_STEPS = 8;

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export type { CreateBriefCard };

interface TurnState {
  brief: CampaignBrief;
  topicId: string | null;
  topicTitle: string | null;
  funnelStage: FunnelStage | null;
  options: SuggestedOption[] | null;
  // Set by generate_content or create_blog_from_email once a draft actually
  // exists; the client auto-navigates to /drafts/[draftId] when present.
  draftId: string | null;
  channel: "email" | "blog" | null;
}

/**
 * One create-agent turn: a real agentic tool-use loop. Tool results are fed
 * back into the same request so the model can chain brief -> topic -> draft
 * without waiting for a fresh user message. History is held client-side (sent
 * each turn) and mirrored into campaigns.chat_state for resume-on-reload; the
 * campaign row is also the brief/topic holder, unchanged from before. The
 * human approval gate stays at publish only; generate_content here creates a
 * fast draft SHELL (real generation streams later on the review page), so
 * driving straight to a draft is cheap.
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
    // client, mirrored into chat_state below). Load it if the client passed
    // an id, otherwise create one.
    let campaign = campaignId ? await getCampaign(campaignId) : null;
    if (!campaign) campaign = await createCampaign(brand.id);

    const [products, topics, memories] = await Promise.all([
      listProducts(brand.id),
      listTopics(),
      listBrandMemory(brand.id),
    ]);

    // The system prompt holds only the STABLE brand context (+ learned
    // memory) so it caches across turns; the mutating brief-so-far rides in
    // the latest user turn instead (it's never persisted to history, so it
    // can't go stale there).
    const system = cacheableSystem(
      buildCreateAgentSystem({ brand, strategy, primaryIcp, products, topics, memories }),
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
    const briefState = buildBriefStateBlock(
      campaign.brief ?? {},
      campaign.topic_id,
    );
    const messages: Anthropic.MessageParam[] = [
      ...priorTurns,
      {
        role: "user",
        content: `${briefState}\n\nUSER MESSAGE:\n${message.trim()}`,
      },
    ];

    const state: TurnState = {
      brief: campaign.brief ?? {},
      topicId: campaign.topic_id,
      // Seed the card's topic/CTA rows from the attached topic so they show
      // immediately on turns that don't re-select.
      ...topicContextFor(campaign.topic_id, topics),
      options: null,
      draftId: null,
      channel: null,
    };
    const dispatchCtx = { brand, strategy, topics, campaignId: campaign.id };

    // Snapshot readiness BEFORE this turn: if the brief was already complete
    // walking in and the whole turn produces zero tool calls, the model
    // narrated ("let me put that together...") instead of acting, the same
    // stall this loop otherwise has no way to recover from (it just breaks on
    // the first text-only step and leaves the user to nudge with another
    // message).
    const briefWasReady = !!(
      campaign.brief?.goal &&
      campaign.brief?.key_message &&
      campaign.topic_id
    );

    const call = () =>
      getAnthropic().messages.create({
        model: DRAFT_MODEL,
        max_tokens: 1024,
        system,
        messages,
        tools: CREATE_TOOLS,
        tool_choice: { type: "auto" },
      });

    let reply = "";
    let calledAnyTool = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      let response;
      try {
        response = await call();
      } catch (err) {
        logError("api:/api/create/chat", err, { step });
        response = await call();
      }
      logUsage("create-chat", DRAFT_MODEL, response.usage);

      for (const block of response.content) {
        if (block.type === "text") reply += block.text;
      }
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        calledAnyTool = true;
        const content = await dispatchTool(block, state, dispatchCtx);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // Stall recovery, mirroring /api/campaigns/chat: brief was already ready
    // going into this turn but nothing happened. Force one more step; if that
    // still doesn't produce a tool call, at least readyToGenerate (computed
    // below from state.brief/topicId, unaffected by whether a tool fired)
    // will be true so the client's manual Generate button is there instead of
    // requiring another message.
    if (briefWasReady && !calledAnyTool && !state.draftId) {
      try {
        const forced = await getAnthropic().messages.create({
          model: DRAFT_MODEL,
          max_tokens: 1024,
          system,
          messages,
          tools: CREATE_TOOLS,
          tool_choice: { type: "any" },
        });
        logUsage("create-chat-forced", DRAFT_MODEL, forced.usage);
        messages.push({ role: "assistant", content: forced.content });
        let forcedReply = "";
        for (const block of forced.content) {
          if (block.type === "text") forcedReply += block.text;
          if (block.type === "tool_use") {
            await dispatchTool(block, state, dispatchCtx);
          }
        }
        if (forcedReply.trim()) reply = forcedReply;
      } catch (err) {
        logError("api:/api/create/chat:forced-action", err);
      }
    }

    if (!reply.trim()) {
      reply = state.draftId
        ? "Done, opening your draft now."
        : "Got it. What's the one thing this email needs to land?";
    }
    reply = stripEmDashes(reply);

    const readyToGenerate = !!(
      state.brief.goal &&
      state.brief.key_message &&
      state.topicId
    );

    // Mirror the exchange into chat_state so a page reload can resume the
    // thread (getLatestActiveCampaign + hydration in page.tsx/CreateAgent).
    // Only the plain text is kept, not the intermediate tool_use/tool_result
    // blocks: their effects are already captured in brief/topic_id/memory,
    // which are re-injected fresh every turn, so replaying tool minutiae adds
    // tokens without adding information.
    const transcript: ChatMsg[] = [
      ...(history ?? []).slice(-38),
      { role: "user" as const, content: message.trim() },
      { role: "assistant" as const, content: reply },
    ].slice(-40);

    await updateCampaign(campaign.id, {
      brief: state.brief,
      topic_id: state.topicId,
      chat_state: { messages: transcript },
      ...(state.draftId ? { status: "generating" as const } : {}),
    });

    const card = buildBriefCard({
      brand,
      strategy,
      primaryIcp,
      products,
      brief: state.brief,
      topicTitle: state.topicTitle,
      funnelStage: state.funnelStage,
    });

    return NextResponse.json({
      reply,
      campaignId: campaign.id,
      topicId: state.topicId,
      brief: state.brief,
      card,
      options: state.options,
      readyToGenerate,
      draftId: state.draftId,
      channel: state.channel,
    });
  } catch (err) {
    logError("api:/api/create/chat", err);
    return NextResponse.json(
      { error: "The create agent hit a snag. Try again." },
      { status: 500 },
    );
  }
}

/**
 * Executes one tool call and returns its real tool_result content (never a
 * stubbed placeholder), so the model can chain off actual state, e.g. see
 * that select_topic found nothing and correct itself, or see generate_content's
 * draftId and wrap up the turn.
 */
async function dispatchTool(
  block: Anthropic.Messages.ToolUseBlock,
  state: TurnState,
  ctx: {
    brand: Brand;
    strategy: Strategy | null;
    topics: CampaignTopicOption[];
    campaignId: string;
  },
): Promise<string> {
  switch (block.name) {
    case "update_brief": {
      const input = block.input as UpdateBriefInput;
      state.brief = mergeBrief(state.brief, input);
      const saved = (
        ["goal", "audience_notes", "key_message", "offer_slug", "angle", "constraints"] as const
      )
        .filter((k) => typeof input[k] === "string" && input[k]!.trim())
        .map((k) => `${k}=${state.brief[k]}`);
      return saved.length ? `Saved: ${saved.join("; ")}` : "No new fields to save.";
    }
    case "select_topic": {
      const input = block.input as SelectTopicInput;
      const found = ctx.topics.find((t) => t.id === input.topic_id);
      if (!found) {
        return `No topic found with id ${input.topic_id}. Use an exact id from the TOPICS list.`;
      }
      state.topicId = found.id;
      state.topicTitle = found.title;
      state.funnelStage = (found.funnel_stage as FunnelStage) ?? null;
      return `Attached topic "${found.title}" (${found.funnel_stage ?? "no funnel stage"}).`;
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
      return `Created topic "${topic.title}" (id=${topic.id}).`;
    }
    case "suggest_options": {
      const input = block.input as SuggestOptionsInput;
      // Drop hallucinated topic ids; action-kind ids are free-form by design.
      state.options = (input.options ?? []).filter(
        (o) => o.kind !== "topic" || ctx.topics.some((t) => t.id === o.id),
      );
      return "Options shown to the user.";
    }
    case "generate_content": {
      const input = block.input as GenerateContentInput;
      if (!state.topicId) {
        return "Cannot generate yet: no topic is attached to the brief.";
      }
      const topicCtx = await getTopicContext(state.topicId);
      if (!topicCtx) return "That topic no longer exists.";
      const draftId = await createDraftShell({
        ctx: topicCtx,
        campaignId: ctx.campaignId,
        type: input.channel,
        emailType: input.email_type,
        blogType: input.blog_type,
      });
      state.draftId = draftId;
      state.channel = input.channel;
      return JSON.stringify({ draftId, channel: input.channel });
    }
    case "list_recent_content": {
      const input = block.input as ListRecentContentInput;
      const rows = await listDrafts({ jobType: input.job_type });
      return JSON.stringify(
        rows.slice(0, 15).map((r) => ({
          id: r.id,
          subject: r.subject || "(untitled)",
          type: r.job_type,
          state: r.state,
          topic: r.topic_title,
        })),
      );
    }
    case "get_content": {
      const input = block.input as GetContentInput;
      const draft = await getDraftForReview(input.draft_id);
      if (!draft) return `No draft found with id ${input.draft_id}.`;
      return JSON.stringify({
        id: draft.id,
        subject: draft.content.subject,
        preheader: draft.content.preheader,
        state: draft.state,
        topic: draft.topic_title,
        type: draft.job_type,
        created_at: draft.created_at,
      });
    }
    case "create_blog_from_email": {
      const input = block.input as CreateBlogFromEmailInput;
      // Never duplicate: reuse the existing spin-off if this email already has one.
      const existing = await getBlogDraftFromEmail(input.source_draft_id);
      if (existing) {
        state.draftId = existing.draftId;
        state.channel = "blog";
        return JSON.stringify({ draftId: existing.draftId, channel: "blog", reused: true });
      }
      const source = await getDraftWithJobContext(input.source_draft_id);
      if (!source || !source.topicId) {
        return "That draft has no topic to build a blog post from.";
      }
      const topicCtx = await getTopicContext(source.topicId);
      if (!topicCtx) return "That draft's topic no longer exists.";
      const draftId = await createDraftShell({
        ctx: topicCtx,
        campaignId: source.campaignId ?? undefined,
        type: "blog",
        sourceDraftId: input.source_draft_id,
      });
      state.draftId = draftId;
      state.channel = "blog";
      return JSON.stringify({ draftId, channel: "blog", reused: false });
    }
    case "remember": {
      const input = block.input as RememberInput;
      const memory = await addBrandMemory(ctx.brand.id, {
        content: stripEmDashes(input.content.trim()),
        kind: input.kind,
        source: "create_agent",
      });
      return `Remembered (id=${memory.id}).`;
    }
    case "forget": {
      const input = block.input as ForgetInput;
      await deleteBrandMemory(input.memory_id);
      return "Removed.";
    }
    default:
      return "Unknown tool.";
  }
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

