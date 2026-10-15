import { NextRequest, NextResponse } from "next/server";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  FAST_MODEL,
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
  createCompetitorReference,
  createDraftShell,
  createTopic,
  deleteBrandMemory,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBlogDraftFromEmail,
  getBrandWithIcps,
  getCampaign,
  getDesignLook,
  getDraftForReview,
  createDesignLook,
  getDraftWithJobContext,
  getFlyerDraftFromEmail,
  getTopicContext,
  listBrandMemory,
  listCompetitorReferences,
  listDrafts,
  listProducts,
  listTopics,
  updateCampaign,
} from "@/lib/db/queries";
import type {
  Brand,
  ClientBrand,
  CampaignBrief,
  ChatPreviewRef,
  FactoryKind,
  FunnelStage,
  Product,
  SeriesDraftRef,
  Strategy,
} from "@/lib/db/types";
import { CAMPAIGN_BRIEF_TEXT_FIELDS } from "@/lib/db/types";
import {
  CHAT_WEB_TOOLS,
  CREATE_TOOLS,
  buildCreateAgentSystem,
  type CampaignTopicOption,
  type CreateBlogFromEmailInput,
  type CreateFlyerFromEmailInput,
  type CreateTopicInput,
  type ForgetInput,
  type GenerateContentInput,
  type GetContentInput,
  type ListRecentContentInput,
  type StartCampaignInput,
  type RememberInput,
  type RevisePieceInput,
  type SaveCompetitorReferenceInput,
  type SaveLookInput,
  type SelectTopicInput,
  type SuggestedOption,
  type SuggestOptionsInput,
  type UpdateBriefInput,
} from "@/prompts/create-agent";
import { buildBriefStateBlock } from "@/prompts/brand-voice";
import { DEFAULT_FLYER_ASPECT, isFlyerAspect } from "@/prompts/generate-flyer";
import { buildBriefCard, topicContextFor, type CreateBriefCard } from "@/lib/brief-card";
import { extractCompetitorProfile } from "@/lib/pipeline/extract-competitor";
import { describeOurStyle } from "@/lib/pipeline/generate-flyer";
import { cleanFlyerEdit, type PreviewAction } from "@/lib/chat-preview";
import { cleanExamples, cleanLookName, storageHostFromEnv } from "@/lib/looks";
import { extractLookProfile } from "@/lib/pipeline/extract-look";
import { loadOnScreen, type OnScreen } from "@/lib/chat-on-screen";
import { scrapeCompetitorAdUrl } from "@/lib/scrape";
import { parseAdLibraryUrl } from "@/lib/scrape/url";
import { adLibraryAdUrl } from "@/lib/clients/scrapecreators";
import { joinReplySegments, stripEmDashes, stripMarkdown } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";
import { buildConversationNotes, isHttpUrl, mergeBrief } from "./brief-merge";
import { userAskedForResearch } from "./research-consent";
import { FACTORY_KINDS } from "@/prompts/campaign-formats";

// A turn can chain several tool round-trips (brief -> topic -> generate); give
// it real headroom rather than the old single-call budget.
export const maxDuration = 300;

// Real chains are short (update_brief -> select_topic/create_topic ->
// generate_content is 2-3 round-trips); 8 gives slack for a clarify-then-
// continue turn without letting a confused model loop indefinitely.
const MAX_STEPS = 8;

// Tools whose results never change what the model says next (they save or
// display), so a turn that already has its reply text can end right after
// them. select_topic is the one that can fail (a bad id); the loop checks for
// that before ending the turn.
const INTERVIEW_ONLY_TOOLS = new Set([
  "show_look_picker",
  "update_brief",
  "suggest_options",
  "remember",
  "forget",
  "select_topic",
  "create_topic",
]);

/** A campaign the agent handed off, with the settings the planner needs. */
interface StartedCampaign {
  summary: string;
  kinds: FactoryKind[];
  size: number;
  days: number;
  research: boolean;
  photo_url?: string;
  reference_urls?: string[];
  client_brand?: ClientBrand;
  competitor_reference_id?: string;
}

const NO_OUR_STYLE =
  "Our style has no reference images yet, so it can't be used. Say so in one " +
  "line, and ask them to tap Add examples under Our style in the picker below " +
  "your reply (2 or 3 of their own designs), or pick No reference to let you " +
  "choose a fresh style.";

/** Flyers follow a saved look, No reference, or Our style; only the last can
 * be empty, and an empty one must never fall back silently. */
async function canUseOurStyle(ctx: { brand: Brand; lookId?: string }): Promise<boolean> {
  return Boolean(ctx.lookId) || (await describeOurStyle(ctx.brand.id)) !== null;
}

/** What the chat shows while a tool runs; null for tools that only save. */
function toolStatusLabel(block: Anthropic.Messages.ToolUseBlock): string | null {
  switch (block.name) {
    case "update_brief":
      return "Saving the details";
    case "select_topic":
    case "create_topic":
      return "Lining up the topic";
    case "generate_content": {
      const channel = (block.input as GenerateContentInput).channel;
      return channel === "social"
        ? "Setting up your flyer"
        : channel === "blog"
          ? "Setting up your blog post"
          : "Setting up your email";
    }
    case "start_campaign":
      return "Handing it to the planner";
    case "edit_flyer":
    case "revise_piece":
      return "Lining up the change";
    case "list_recent_content":
    case "get_content":
      return "Looking through your past content";
    case "create_blog_from_email":
    case "create_flyer_from_email":
      return "Setting it up";
    case "save_competitor_reference":
      return "Studying that ad";
    case "save_look":
      return "Saving the look";
    case "remember":
    case "forget":
      return "Remembering that";
    default:
      return null;
  }
}

/** Adds an instruction for the model after its last step, keeping roles
 * alternating (a tool-result turn takes it as an extra text block). */
function pushUserNote(messages: Anthropic.MessageParam[], text: string) {
  const last = messages[messages.length - 1];
  if (last?.role === "user" && Array.isArray(last.content)) {
    last.content = [...last.content, { type: "text", text }];
  } else {
    messages.push({ role: "user", content: text });
  }
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

/** Only the app's own Supabase storage host may be injected as an image
 * block (SSRF guard against a client-supplied URL pointing anywhere else). */
function allowedImageHost(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
}

function sanitizeImageUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls?.length) return undefined;
  const host = allowedImageHost();
  if (!host) return undefined;
  const safe = urls.filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  return safe.length ? safe : undefined;
}

/** Images the image pipeline will fetch server-side must be our own uploads,
 * the same host rule as sanitizeImageUrls; anything else is dropped. */
function keepOwnImages(brief: CampaignBrief): CampaignBrief {
  const next = { ...brief };
  if (next.style_reference_urls) {
    const safe = sanitizeImageUrls(next.style_reference_urls);
    if (safe) next.style_reference_urls = safe;
    else delete next.style_reference_urls;
  }
  const logo = next.client_brand?.logo_url;
  if (next.client_brand && logo && !sanitizeImageUrls([logo])) {
    next.client_brand = { ...next.client_brand };
    delete next.client_brand.logo_url;
  }
  return next;
}

/** Wraps a user message's text as a plain string (cheap) or, when images are
 * attached, a content array carrying real image blocks so the model sees
 * them (vision) plus their URLs in the text so it can echo one back into
 * update_brief.product_photo_url. */
function withImageBlocks(
  text: string,
  images: string[] | undefined,
): Anthropic.MessageParam["content"] {
  if (!images?.length) return text;
  const urlList = images.map((u, i) => `u${i + 1}: ${u}`).join(", ");
  return [
    {
      type: "text",
      text: `${text}\n\nATTACHED IMAGES (visible above; URLs: ${urlList}). If one is the product photo to feature, call update_brief with product_photo_url set to that exact URL. If they're photos to appear in the email itself, call update_brief with photo_urls listing those exact URLs (all of them, in order). If one is a design the flyer should look like, call update_brief with style_reference_urls set to its exact URL. If a flyer is ON SCREEN and the photo is for it, call edit_flyer with photo_url set to that exact URL instead.`,
    },
    ...images.map((url) => ({
      type: "image" as const,
      source: { type: "url" as const, url },
    })),
  ];
}

const BARE_URL_RE = /https?:\/\/[^\s<>"')\]]+/i;
// Its own pattern: Ad Library links carry sort_data[...] brackets, which
// BARE_URL_RE stops at before view_all_page_id.
const AD_LIBRARY_URL_RE = /https?:\/\/(?:[\w-]+\.)*facebook\.com\/ads\/library\/?\?\S+/i;

/** An advertiser's Ad Library link in the message, for the chat's ad picker. */
function findAdLibraryUrl(message: string): string | null {
  const url = message.match(AD_LIBRARY_URL_RE)?.[0];
  return url && parseAdLibraryUrl(url) ? url : null;
}

/**
 * When the message contains a bare URL and no image is attached, scrapes it
 * server-side (SSRF-guarded, see lib/scrape) and appends a system note with
 * either the extracted text or an honest "couldn't read it" guidance message
 * (login-walled pages fall into the latter; Facebook Ad Library links get
 * pointed at the Competitor Ads import instead). The model decides what to do with it (competitor ad vs. unrelated
 * link) per the COMPETITOR ADS CAN ARRIVE AT ANY STAGE rule in
 * buildCreateAgentSystem; this only makes sure it never has to guess at a
 * naked link's contents.
 */
async function withScrapedCompetitorUrl(
  message: string,
  hasImages: boolean,
): Promise<string> {
  if (hasImages) return message;
  const match = message.match(BARE_URL_RE);
  if (!match) return message;
  const url = match[0];
  const scraped = await scrapeCompetitorAdUrl(url).catch(() => null);
  if (!scraped) return message;
  const note = scraped.ok
    ? `SYSTEM NOTE: scraped ${url}. If this is a competitor ad the user wants ` +
      `saved, call save_competitor_reference with input_kind "text", this ` +
      `content, and source_url "${url}":\n--- SCRAPED TEXT START ---\n${scraped.content}\n--- SCRAPED TEXT END ---`
    : `SYSTEM NOTE: couldn't read ${url} (${scraped.guidance}). If the user ` +
      `wanted to save it as a competitor ad, tell them and ask for pasted ` +
      `copy or a screenshot instead.`;
  return `${message}\n\n${note}`;
}

export type { CreateBriefCard };


interface TurnState {
  brief: CampaignBrief;
  topicId: string | null;
  topicTitle: string | null;
  funnelStage: FunnelStage | null;
  options: SuggestedOption[] | null;
  // Set by generate_content or create_blog_from_email once a draft actually
  // exists; it becomes the piece the client previews in the thread.
  draftId: string | null;
  channel: "email" | "blog" | "social" | null;
  // Drafts from the retired email-series tool, kept so old chats still show
  // their series card on resume.
  series: SeriesDraftRef[] | null;
  // Set by start_campaign: what the client hands to /api/factory.
  campaign: StartedCampaign | null;
  // Set by show_look_picker: the client shows the look picker under the reply.
  showLookPicker: boolean;
  // An Ad Library link from this message: the client shows its ads to pick from.
  adLibraryUrl: string | null;
  // Set by edit_flyer / revise_piece: the client's preview card applies it.
  previewAction: PreviewAction | null;
}


/**
 * One create-agent turn: a real agentic tool-use loop. Tool results are fed
 * back into the same request so the model can chain brief -> topic -> draft
 * without waiting for a fresh user message. History is held client-side (sent
 * each turn) and mirrored into campaigns.chat_state for resume-on-reload; the
 * campaign row is also the brief/topic holder, unchanged from before. The
 * human approval gate stays at publish only; generate_content here creates a
 * fast draft SHELL (real generation then streams in the chat's preview card), so
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

    const { message, history, campaignId, images, auto, lookId, competitorAdId } =
      (await req.json()) as {
        message?: string;
        history?: ChatMsg[];
        campaignId?: string | null;
        images?: string[];
        auto?: boolean;
        lookId?: string | null;
        /** The first ad ticked in the chat's Ad Library picker (an ad archive id). */
        competitorAdId?: string | null;
      };
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const data = await getBrandWithIcps(sessionUser.id);
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand, strategy, icps } = data;
    // A look id from the client must be one of this brand's looks.
    if (lookId && lookId !== "none" && !(await getDesignLook(lookId, brand.id))) {
      return NextResponse.json({ error: "That look doesn't exist." }, { status: 404 });
    }
    const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;

    // The campaign row holds the brief across turns (history lives on the
    // client, mirrored into chat_state below). Load it if the client passed
    // an id, otherwise create one.
    let campaign = campaignId ? await getCampaign(campaignId) : null;
    if (campaign && campaign.brand_id !== brand.id) campaign = null;
    if (!campaign) campaign = await createCampaign(brand.id);

    const [products, topics, memories] = await Promise.all([
      listProducts(brand.id),
      listTopics(brand.id),
      listBrandMemory(brand.id),
    ]);

    // Mode persists on the campaign's chat_state across turns; the client
    // resends it every turn, but fall back to whatever was last saved so a
    // stray request that omits it doesn't silently drop back to guided.
    const autoMode = typeof auto === "boolean" ? auto : (campaign.chat_state?.auto ?? false);

    // The system prompt holds only the STABLE brand context (+ learned
    // memory) so it caches across turns; the mutating brief-so-far rides in
    // the latest user turn instead (it's never persisted to history, so it
    // can't go stale there). Toggling mode deliberately busts the cache
    // since it's a different prompt; that's fine, it's not a per-turn event.
    const system = cacheableSystem(
      buildCreateAgentSystem({
        brand,
        strategy,
        primaryIcp,
        products,
        topics,
        memories,
        auto: autoMode,
      }),
    );

    // Cache the prefix through the end of the prior turn so each new message
    // only pays full price on the small bit that's actually new. 20, not 10:
    // a campaign thread passes 10 messages by its build step, and dropping
    // its opening made a follow-up "ok" restart as a brand-new email.
    const priorTurns: Anthropic.MessageParam[] = (history ?? [])
      .slice(-20)
      .map((m) => ({
        role: m.role,
        content:
          m.role === "user" ? withImageBlocks(m.content, sanitizeImageUrls(m.images)) : m.content,
      }));
    if (priorTurns.length > 0) {
      priorTurns[priorTurns.length - 1] = withCacheBreakpoint(
        priorTurns[priorTurns.length - 1],
      );
    }
    const briefState = buildBriefStateBlock(
      campaign.brief ?? {},
      campaign.topic_id,
    );
    const onScreen = await loadOnScreen(campaign.chat_state?.preview, brand.id);
    const sanitizedImages = sanitizeImageUrls(images);
    // A bare URL in the message (and no attached image, which already has
    // its own handling) might be a competitor ad the user wants saved: scrape
    // it server-side now so the model sees real extracted text or an honest
    // "couldn't read it" note, never a naked link it would have to guess about.
    // An Ad Library page is never scraped here: the client shows its ads to
    // pick from, through the same preview/save routes the Media page uses.
    const adLibraryUrl = sanitizedImages?.length ? null : findAdLibraryUrl(message);
    // The picker saved the ticked ads before sending; the first one shapes
    // this piece. Looked up by source_url so an ad saved earlier counts too.
    const pickedAd =
      competitorAdId && /^\d+$/.test(competitorAdId)
        ? ((await listCompetitorReferences(brand.id)).find(
            (r) => r.source_url === adLibraryAdUrl(competitorAdId),
          ) ?? null)
        : null;
    let messageForModel = adLibraryUrl
      ? `${message.trim()}\n\nSYSTEM NOTE: ${adLibraryUrl} is a Facebook Ad Library page. ` +
        "Its top ads are showing as a picker under your reply. In one short line, ask " +
        "them to tick the ads worth learning from; the first one they tick shapes this " +
        "piece. Don't call save_competitor_reference for it."
      : await withScrapedCompetitorUrl(message.trim(), !!sanitizedImages?.length);
    if (pickedAd) {
      messageForModel +=
        `\n\nSYSTEM NOTE: the ads they ticked are saved to Competitor Ads, and ` +
        `"${pickedAd.name}" is attached to this piece. Say in one line you'll adapt ` +
        "its hook, structure, and some of its phrasing in the brand's own voice, never " +
        "copy it, then carry on.";
    }
    const messages: Anthropic.MessageParam[] = [
      ...priorTurns,
      {
        role: "user",
        content: withImageBlocks(
          `${briefState}${onScreen ? `\n\n${onScreen.line}` : ""}\n\nUSER MESSAGE:\n${messageForModel}`,
          sanitizedImages,
        ),
      },
    ];

    // Refreshed every turn (not merged) so the digest always reflects the whole
    // conversation as it stands, including edits and corrections.
    const conversationNotes = buildConversationNotes(history, message.trim());

    const state: TurnState = {
      brief: {
        ...(campaign.brief ?? {}),
        ...(conversationNotes ? { conversation_notes: conversationNotes } : {}),
        ...(pickedAd ? { competitor_reference_id: pickedAd.id } : {}),
      },
      topicId: campaign.topic_id,
      // Seed the card's topic/CTA rows from the attached topic so they show
      // immediately on turns that don't re-select.
      ...topicContextFor(campaign.topic_id, topics),
      options: null,
      draftId: null,
      channel: null,
      series: null,
      campaign: null,
      showLookPicker: false,
      adLibraryUrl,
      previewAction: null,
    };
    const dispatchCtx = {
      brand,
      strategy,
      topics,
      products,
      campaignId: campaign.id,
      lookId: lookId || undefined,
      onScreen,
      userMessages: [
        ...(history ?? []).filter((m) => m.role === "user").map((m) => m.content),
        message.trim(),
      ],
    };

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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // The client went away; the turn still finishes and saves.
          }
        };
        try {
          // Streams each step so the reply appears word by word; a blank line goes
          // between steps that both speak.
          let needsGap = false;
          const call = () => {
            const stream = getAnthropic().messages.stream({
              model: DRAFT_MODEL,
              // 2048, not 1024: a turn can chain several tool calls of brief
              // fields alongside the reply text.
              max_tokens: 2048,
              // Automatic caching: moves a breakpoint onto the newest block each
              // step, so later tool round-trips in this turn read the earlier ones
              // from cache instead of re-paying full input for them.
              cache_control: { type: "ephemeral" },
              system,
              messages,
              tools: [...CREATE_TOOLS, ...CHAT_WEB_TOOLS],
              tool_choice: { type: "auto" },
            });
            stream.on("text", (delta) => {
              send("delta", { text: needsGap ? `\n\n${delta}` : delta });
              needsGap = false;
            });
            stream.on("streamEvent", (event) => {
              if (event.type !== "content_block_start") return;
              if (event.content_block.type !== "server_tool_use") return;
              send("status", {
                label: event.content_block.name === "web_fetch" ? "Reading the page" : "Searching the web",
              });
              needsGap = true;
            });
            return stream.finalMessage();
          };

          send("status", { label: sanitizedImages ? "Looking at your photos" : "Thinking" });

          // One turn can span several tool round-trips, each with its own text block.
          // Collected, then joined (see joinReplySegments): raw concatenation ran them
          // together and printed a repeated question twice.
          const replyParts: string[] = [];
          let calledAnyTool = false;
          for (let step = 0; step < MAX_STEPS; step++) {
            if (step > 0) send("status", { label: "Thinking" });
            let response;
            try {
              response = await call();
            } catch (err) {
              logError("api:/api/create/chat", err, { step });
              // Whatever streamed before the failure is about to be said again.
              send("reset", {});
              response = await call();
            }
            logUsage("create-chat", DRAFT_MODEL, response.usage, { brandId: brand.id });

            // Search citations split one sentence across several text blocks, so
            // adjacent text blocks join as-is; only text on either side of a
            // tool call is a separate segment.
            let segment = "";
            for (const block of response.content) {
              if (block.type === "text") {
                segment += block.text;
              } else {
                if (segment) replyParts.push(segment);
                segment = "";
              }
            }
            if (segment) replyParts.push(segment);
            if (response.content.some((b) => b.type === "text" && b.text.trim())) needsGap = true;
            if (response.content.some((b) => b.type === "server_tool_use")) calledAnyTool = true;
            messages.push({ role: "assistant", content: response.content });

            // The server's search loop paused mid-turn: resend as-is and it resumes.
            if (response.stop_reason === "pause_turn") continue;
            if (response.stop_reason !== "tool_use") break;

            const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
            const draftBefore = state.draftId;
            let topicLookupFailed = false;
            for (const block of response.content) {
              if (block.type !== "tool_use") continue;
              calledAnyTool = true;
              const label = toolStatusLabel(block);
              if (label) send("status", { label });
              const content = await dispatchTool(block, state, dispatchCtx);
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
              if (
                block.name === "select_topic" &&
                state.topicId !== (block.input as SelectTopicInput).topic_id
              ) {
                topicLookupFailed = true;
              }
            }
            messages.push({ role: "user", content: toolResults });

            // A draft now exists and the client opens it straight away, so a reply
            // call would only produce "opening your draft" (the fallback below says
            // exactly that).
            if (state.draftId && state.draftId !== draftBefore) break;
            // Same for a campaign: the client takes over and runs the planner.
            if (state.campaign) break;
            // And for a change to the piece on screen, once it's been announced.
            if (state.previewAction && response.content.some((b) => b.type === "text" && b.text.trim())) break;

            // The follow-up call after an interview step is nearly always an empty
            // reply (the question was already asked alongside the tool call), yet it
            // re-reads the whole ~18k-token prompt. Skip it when the turn is plainly
            // waiting on the user. Not when the brief just became ready or a
            // campaign is being planned: those turns chain on into generate_content
            // or start_campaign.
            const waitingOnUser =
              response.content.some((b) => b.type === "text" && b.text.trim()) &&
              response.content.every(
                (b) => b.type !== "tool_use" || INTERVIEW_ONLY_TOOLS.has(b.name),
              ) &&
              !topicLookupFailed &&
              !state.brief.campaign_kind &&
              !(state.brief.goal && state.brief.key_message && state.topicId);
            if (waitingOnUser) break;
          }

          // Stall recovery: brief was already ready going into this turn but
          // nothing happened. Force one more step; if that
          // still doesn't produce a tool call, at least readyToGenerate (computed
          // below from state.brief/topicId, unaffected by whether a tool fired)
          // will be true so the client's manual Generate button is there instead of
          // requiring another message.
          if (briefWasReady && !calledAnyTool && !state.draftId) {
            try {
              const forced = await getAnthropic().messages.create({
                model: FAST_MODEL,
                max_tokens: 1024,
                system,
                messages,
                tools: CREATE_TOOLS,
                tool_choice: { type: "any" },
              });
              logUsage("create-chat-forced", FAST_MODEL, forced.usage, {
                brandId: brand.id,
              });
              messages.push({ role: "assistant", content: forced.content });
              const forcedParts: string[] = [];
              for (const block of forced.content) {
                if (block.type === "text") forcedParts.push(block.text);
                if (block.type === "tool_use") {
                  await dispatchTool(block, state, dispatchCtx);
                }
              }
              const forcedReply = joinReplySegments(forcedParts);
              if (forcedReply) {
                replyParts.length = 0;
                replyParts.push(forcedReply);
              }
            } catch (err) {
              logError("api:/api/create/chat:forced-action", err);
            }
          }

          // Never leave the user hanging: a turn that made nothing, offered no
          // choices, and asked nothing gets one more step to ask the next question.
          const askedSomething =
            /\?/.test(joinReplySegments(replyParts)) ||
            Boolean(state.options?.length) ||
            state.showLookPicker ||
            Boolean(state.adLibraryUrl);
          if (!state.draftId && !state.campaign && !state.previewAction && !askedSomething) {
            try {
              pushUserNote(
                messages,
                "SYSTEM NOTE: your reply didn't ask anything or move things forward, so the user " +
                  "has nothing to answer. Continue now: ask the next question you need, with " +
                  "tappable options when real choices exist. One short reply, no recap.",
              );
              send("status", { label: "Thinking" });
              const nudged = await call();
              logUsage("create-chat-nudge", DRAFT_MODEL, nudged.usage, { brandId: brand.id });
              for (const block of nudged.content) {
                if (block.type === "text") replyParts.push(block.text);
                if (block.type === "tool_use") await dispatchTool(block, state, dispatchCtx);
              }
            } catch (err) {
              logError("api:/api/create/chat:nudge", err);
            }
          }

          let reply = joinReplySegments(replyParts);
          if (!reply) {
            reply = state.draftId
              ? "Making it now. It'll show up right here."
              : state.campaign
                ? "Planning it now."
                : state.previewAction
                  ? "On it, updating the preview now."
                  : "What's the one thing this email needs to land?";
          }
          // Chat bubbles render as plain text, so any markdown the model slipped in
          // would reach the user as literal asterisks. The prompt forbids it; this
          // enforces it.
          reply = stripMarkdown(stripEmDashes(reply));

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
            {
              role: "user" as const,
              content: message.trim(),
              ...(sanitizedImages ? { images: sanitizedImages } : {}),
            },
            { role: "assistant" as const, content: reply },
          ].slice(-40);

          // series persists across turns (a follow-up message must not wipe the
          // card): keep whatever this turn produced, else what the campaign had.
          const series = state.series ?? campaign.chat_state?.series ?? null;
          // A piece made this turn replaces whatever was on screen.
          const preview: ChatPreviewRef | null =
            state.draftId && state.channel
              ? { draft_id: state.draftId, channel: state.channel }
              : (campaign.chat_state?.preview ?? null);

          await updateCampaign(campaign.id, {
            brief: state.brief,
            topic_id: state.topicId,
            chat_state: {
              messages: transcript,
              auto: autoMode,
              ...(series ? { series } : {}),
              ...(preview ? { preview } : {}),
            },
            ...(state.draftId || state.series
              ? { status: "generating" as const }
              : {}),
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

          send("done", {
            reply,
            campaignId: campaign.id,
            topicId: state.topicId,
            brief: state.brief,
            card,
            options: state.options,
            readyToGenerate,
            draftId: state.draftId,
            channel: state.channel,
            series,
            campaign: state.campaign,
            showLookPicker: state.showLookPicker,
            adLibraryUrl: state.adLibraryUrl,
            preview: state.draftId && state.channel
              ? { draftId: state.draftId, channel: state.channel }
              : onScreen
                ? { draftId: onScreen.draftId, channel: onScreen.channel }
                : null,
            previewAction: state.previewAction,
            auto: autoMode,
          });
        } catch (err) {
          logError("api:/api/create/chat", err);
          send("error", { message: "The create agent hit a snag. Try again." });
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
    products: Product[];
    campaignId: string;
    /** The flyer look picked on Create; social drafts only. */
    lookId?: string;
    /** The piece previewed in the chat, if any. */
    onScreen: OnScreen | null;
    /** Every user message this conversation, oldest first. */
    userMessages: string[];
  },
): Promise<string> {
  switch (block.name) {
    case "update_brief": {
      const input = block.input as UpdateBriefInput;
      state.brief = keepOwnImages(
        autoAttachProductPhoto(mergeBrief(state.brief, input), input, ctx.products),
      );
      const saved = ([...CAMPAIGN_BRIEF_TEXT_FIELDS, "visual_vibe"] as const)
        .filter((k) => typeof input[k] === "string" && input[k]!.trim())
        .map((k) => `${k}=${state.brief[k]}`);
      // Presence only: echoing the whole pasted email back as a tool result
      // would just re-spend its tokens.
      if (typeof input.style_example === "string" && input.style_example.trim()) {
        saved.push("style_example=(attached, generation will match its style)");
      }
      if (state.brief.product_photo_url) {
        saved.push("product_photo_url=(attached, will be used as the hero image)");
      }
      if (Array.isArray(input.photo_urls)) {
        const count = state.brief.photo_urls?.length ?? 0;
        saved.push(
          count
            ? `photo_urls=(${count} photo${count === 1 ? "" : "s"} attached, each will be placed in the email)`
            : "photo_urls cleared",
        );
      }
      if (input.use_ai_image_instead === true) {
        saved.push("product_photo_url and photo_urls cleared, an AI image will be generated instead");
      }
      if (state.brief.competitor_reference_id) {
        saved.push("competitor_reference_id=(attached, its strategy will be adapted, never copied)");
      }
      if (Array.isArray(input.style_reference_urls)) {
        const count = state.brief.style_reference_urls?.length ?? 0;
        saved.push(
          count
            ? `style_reference_urls=(${count} design${count === 1 ? "" : "s"} the flyer will match; Our style and the look picker aren't needed)`
            : "style_reference_urls cleared",
        );
      }
      if (input.client_brand && state.brief.client_brand) {
        const cb = state.brief.client_brand;
        saved.push(
          `client_brand=${cb.name} (colors: ${cb.colors?.join(", ") || "none yet"}; logo: ${cb.logo_url ? "attached" : "none yet"})`,
        );
      }
      if (input.campaign_kind === "single") {
        saved.push("campaign_kind cleared, back to a single email");
      } else if (input.campaign_kind && state.brief.campaign_kind === input.campaign_kind) {
        saved.push(`campaign_kind=${input.campaign_kind}`);
      }
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
      const references = state.brief.style_reference_urls;
      if (input.channel === "social" && !references?.length && !(await canUseOurStyle(ctx))) {
        state.showLookPicker = true;
        return `Not made yet. ${NO_OUR_STYLE}`;
      }
      // A standalone social image rides the flyer pipeline: the brief's
      // message/angle/goal become the flyer brief the same way the /flyers/new
      // form's free-text brief does.
      const flyerBrief =
        input.channel === "social"
          ? [
              state.brief.key_message,
              state.brief.angle,
              state.brief.goal ? `Goal: ${state.brief.goal}` : "",
              state.brief.tone ? `Tone: ${state.brief.tone}` : "",
              state.brief.visual_vibe ? `Feel: ${state.brief.visual_vibe}` : "",
              state.brief.offer_deal ? `Offer: ${state.brief.offer_deal}` : "",
              state.brief.offer_price ? `Price: ${state.brief.offer_price}` : "",
              state.brief.constraints,
              state.brief.proof ? `Proof: ${state.brief.proof}` : "",
              state.brief.offer_deadline ? `Deadline: ${state.brief.offer_deadline}` : "",
            ]
              .filter(Boolean)
              .join("\n") || undefined
          : undefined;
      const draftId = await createDraftShell({
        ctx: topicCtx,
        campaignId: ctx.campaignId,
        type: input.channel,
        emailType: input.email_type,
        blogType: input.blog_type,
        ...(input.channel === "social"
          ? {
              flyerAspect: isFlyerAspect(input.flyer_aspect)
                ? input.flyer_aspect
                : DEFAULT_FLYER_ASPECT,
              flyerBrief,
              competitorReferenceId: state.brief.competitor_reference_id,
              flyerFormat: input.social_format === "ad" ? "ad" : "post",
              ...(ctx.lookId ? { lookId: ctx.lookId } : {}),
              ...(state.brief.product_photo_url
                ? { productPhotoUrl: state.brief.product_photo_url }
                : {}),
              ...(references?.length ? { referenceUrls: references } : {}),
            }
          : {}),
      });
      state.draftId = draftId;
      state.channel = input.channel;
      return JSON.stringify({
        draftId,
        channel: input.channel,
        ...(input.channel === "social" && references?.length
          ? {
              note: "It follows their attached design. In your reply, offer in one short line to save that design as a look for next time (save_look).",
            }
          : {}),
      });
    }
    case "start_campaign": {
      const input = block.input as StartCampaignInput;
      const summary = stripEmDashes(input.summary ?? "").trim().slice(0, 500);
      if (!summary) return "start_campaign needs a summary of the campaign.";
      const kinds = FACTORY_KINDS.filter((k) => input.kinds?.includes(k));
      const hasImages = !kinds.length || kinds.includes("social") || kinds.includes("ad");
      const references = state.brief.style_reference_urls;
      if (hasImages && !references?.length && !(await canUseOurStyle(ctx))) {
        state.showLookPicker = true;
        return `Not planned yet. ${NO_OUR_STYLE}`;
      }
      state.campaign = {
        summary,
        kinds: kinds.length ? kinds : [...FACTORY_KINDS],
        size: input.size === 6 || input.size === 20 ? input.size : 12,
        days: input.days === 14 ? 14 : 30,
        // Research spends money: only with the owner's own yes in this chat.
        research: input.research === true && userAskedForResearch(ctx.userMessages),
        ...(state.brief.product_photo_url ? { photo_url: state.brief.product_photo_url } : {}),
        ...(references?.length ? { reference_urls: references } : {}),
        ...(state.brief.competitor_reference_id
          ? { competitor_reference_id: state.brief.competitor_reference_id }
          : {}),
      };
      return "Handed to the planner. Reply with one short line that you're planning it now.";
    }
    case "edit_flyer":
    case "revise_piece": {
      const screen = ctx.onScreen;
      if (!screen) return "Nothing is on screen to change. Make it first with generate_content.";
      if (!screen.ready) return "It's still generating, so it can't change yet. Say it'll be ready in a moment.";
      if (!screen.editable) return "It's already approved, so it can't change here. Offer to make a new one.";
      if (block.name === "revise_piece") {
        const feedback = stripEmDashes((block.input as RevisePieceInput).feedback ?? "").trim().slice(0, 1000);
        if (!feedback) return "Say what to change in feedback.";
        state.previewAction = { kind: "revise", feedback };
        return "Rewriting it now as a new version; the preview shows it when it's ready, in about a minute. Reply with one short line.";
      }
      if (screen.channel !== "social") return "That's not a flyer: use revise_piece for this piece.";
      const action = cleanFlyerEdit(block.input, {
        optionCount: screen.optionCount,
        storageHost: storageHostFromEnv(),
      });
      if (typeof action === "string") return action;
      state.previewAction = action;
      return "Applying it now; the preview updates on its own in a moment. Reply with one short line.";
    }
    case "save_look": {
      const name = cleanLookName((block.input as SaveLookInput).name);
      if (!name) return "Give the look a short name.";
      const examples = cleanExamples(
        (state.brief.style_reference_urls ?? []).map((url) => ({ url, source: "upload" })),
        storageHostFromEnv(),
      );
      if (!examples) return "There are no attached designs in this chat to save.";
      // The flyer already read the design; reuse that instead of paying again.
      const draftId = state.draftId ?? ctx.onScreen?.draftId;
      const made = draftId ? await getDraftWithJobContext(draftId, ctx.brand.id) : null;
      const profile = made?.meta.reference_profile ?? (await extractLookProfile(examples, ctx.brand.id));
      const look = await createDesignLook({ brandId: ctx.brand.id, name, examples, profile, isDefault: false });
      return `Saved as the look "${look.name}". It's in the look picker for future flyers. Reply with one short line.`;
    }
    case "show_look_picker": {
      state.showLookPicker = true;
      const ours = await describeOurStyle(ctx.brand.id);
      return ours
        ? `The look picker is showing under your reply. Our style (the default pick) follows ${ours.name} (${ours.urls.length} reference images).`
        : `The look picker is showing under your reply. ${NO_OUR_STYLE}`;
    }
    case "list_recent_content": {
      const input = block.input as ListRecentContentInput;
      const rows = await listDrafts(ctx.brand.id, { jobType: input.job_type });
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
      const draft = await getDraftForReview(input.draft_id, ctx.brand.id);
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
      const existing = await getBlogDraftFromEmail(input.source_draft_id, ctx.brand.id);
      if (existing) {
        state.draftId = existing.draftId;
        state.channel = "blog";
        return JSON.stringify({ draftId: existing.draftId, channel: "blog", reused: true });
      }
      const source = await getDraftWithJobContext(input.source_draft_id, ctx.brand.id);
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
    case "create_flyer_from_email": {
      const input = block.input as CreateFlyerFromEmailInput;
      // Same reuse-don't-duplicate contract as create_blog_from_email.
      const existing = await getFlyerDraftFromEmail(input.source_draft_id, ctx.brand.id);
      if (existing) {
        state.draftId = existing.draftId;
        state.channel = "social";
        return JSON.stringify({ draftId: existing.draftId, channel: "social", reused: true });
      }
      const source = await getDraftWithJobContext(input.source_draft_id, ctx.brand.id);
      if (!source || !source.topicId) {
        return "That draft has no topic to build a flyer from.";
      }
      const topicCtx = await getTopicContext(source.topicId);
      if (!topicCtx) return "That draft's topic no longer exists.";
      // The flyer pipeline reads meta.source_draft_id back off the shell and
      // distills the EMAIL's copy instead of re-briefing from the bare topic.
      const draftId = await createDraftShell({
        ctx: topicCtx,
        campaignId: source.campaignId ?? undefined,
        type: "social",
        sourceDraftId: input.source_draft_id,
        flyerAspect: "1:1",
      });
      state.draftId = draftId;
      state.channel = "social";
      return JSON.stringify({ draftId, channel: "social", reused: false });
    }
    case "save_competitor_reference": {
      const input = block.input as SaveCompetitorReferenceInput;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) return "Give the competitor ad a name.";
      const inputKind = input.input_kind === "image" ? "image" : "text";

      let content: string | undefined;
      let imageUrl: string | undefined;
      if (inputKind === "image") {
        if (typeof input.image_url !== "string" || !isHttpUrl(input.image_url.trim())) {
          return "No valid image_url given. Pass the exact attached image's URL.";
        }
        imageUrl = input.image_url.trim();
      } else {
        if (typeof input.content !== "string" || !input.content.trim()) {
          return "No content given. Pass the ad's copy verbatim.";
        }
        content = stripEmDashes(input.content.trim()).slice(0, 12000);
      }
      const sourceUrl =
        typeof input.source_url === "string" && isHttpUrl(input.source_url.trim())
          ? input.source_url.trim()
          : undefined;

      // Distill once, now; null (extraction hiccup) still saves the raw
      // ad, which is a usable reference on its own.
      const competitorProfile = await extractCompetitorProfile({ content, imageUrl });
      const reference = await createCompetitorReference({
        brandId: ctx.brand.id,
        name,
        inputKind,
        content: content ?? null,
        imageUrl: imageUrl ?? null,
        sourceUrl: sourceUrl ?? null,
        competitorProfile,
      });
      return JSON.stringify({
        id: reference.id,
        profile: reference.competitor_profile,
      });
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

/** Resolves the product a fresh offer_slug points at, when this exact update_brief
 * call is the one setting it (never re-triggers on unrelated later turns, so a
 * manually uploaded photo is never silently clobbered by a stale offer_slug). */
function autoAttachProductPhoto(
  brief: CampaignBrief,
  input: UpdateBriefInput,
  products: Product[],
): CampaignBrief {
  if (input.use_ai_image_instead === true) return brief;
  if (typeof input.offer_slug !== "string" || !input.offer_slug.trim()) return brief;
  const product = products.find((p) => p.slug === brief.offer_slug);
  if (!product?.image_url) return brief;
  return { ...brief, product_photo_url: product.image_url, include_image: true };
}

