import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand, BrandMemory, Icp, Product, Strategy } from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildFunnelBlock,
  buildGuidelinesBlock,
  buildMemoryBlock,
  buildPositioningBlock,
  buildProductLines,
  buildTopicLines,
} from "./brand-voice";
// The create agent reuses the campaign interview's brief-building tools
// verbatim (update_brief/select_topic/create_topic/suggest_options), but
// deliberately drops propose_voice_updates (so a casual "what are we creating
// today?" can never mutate the durable brand voice profile) and replaces
// start_generation with generate_content (which actually generates instead of
// just flipping a flag for a human to click). The generate/recall/memory
// tools live in ./agent-tools since they're exclusive to this surface.
import {
  CREATE_TOPIC_TOOL,
  SELECT_TOPIC_TOOL,
  SUGGEST_OPTIONS_TOOL,
  UPDATE_BRIEF_TOOL,
  type CampaignTopicOption,
} from "./campaign";
import { AGENT_TOOLS } from "./agent-tools";

// Re-export the input types the route needs to cast tool_use blocks against.
export type {
  CampaignTopicOption,
  CreateTopicInput,
  SelectTopicInput,
  SuggestedOption,
  SuggestOptionsInput,
  UpdateBriefInput,
} from "./campaign";
export type {
  CreateBlogFromEmailInput,
  ForgetInput,
  GenerateContentInput,
  GetContentInput,
  ListRecentContentInput,
  RememberInput,
} from "./agent-tools";

/**
 * The curated toolset for the dashboard create agent: fill a brief, attach
 * (or create) a topic, offer tappable options, generate on command, recall
 * past content, and remember/forget durable account facts.
 */
export const CREATE_TOOLS: Anthropic.Tool[] = [
  UPDATE_BRIEF_TOOL,
  SELECT_TOPIC_TOOL,
  CREATE_TOPIC_TOOL,
  SUGGEST_OPTIONS_TOOL,
  ...AGENT_TOOLS,
];

/**
 * Builds the system prompt for one create-agent turn. The agent reads the
 * stored brand brain and turns the user's freeform "what are we creating
 * today?" into a tight email brief, then drives straight through to a
 * generated draft in the same turn, chaining tool calls rather than pausing
 * between them. Deliberately EXCLUDES the mutating brief-so-far: that arrives
 * at the top of the latest user message (buildBriefStateBlock) so this prefix
 * stays byte-stable across turns and the prompt cache lands.
 */
export function buildCreateAgentSystem(args: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
  products: Product[];
  topics: CampaignTopicOption[];
  memories?: BrandMemory[];
}): string {
  const { brand, strategy, primaryIcp, products, topics, memories = [] } = args;

  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, primaryIcp, "email");
  const positioningBlock = buildPositioningBlock(brand);
  const memoryBlock = buildMemoryBlock(memories);

  return [
    `You are the content creation agent for ${brand.name}. The user opened with`,
    "what they want to make today; your job is to turn that into a tight email",
    "brief and drive it all the way to a generated draft. You are warm, sharp,",
    "and concise, like a trusted collaborator who already knows the brand cold.",
    "",
    "You run a BRIEF-THEN-GENERATE flow, not a long interview. You already know",
    "everything below, so INFER freely and ask at most ONE clarifying question,",
    "and only when something is genuinely ambiguous and un-inferrable.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    memoryBlock,
    "",
    "FUNNEL STAGES AND THEIR CTAs (pick the funnel_stage that matches the goal):",
    buildFunnelBlock(strategy),
    "",
    "PRODUCTS (reference by slug in update_brief.offer_slug):",
    ...buildProductLines(products),
    "",
    "TOPICS ON THE CONTENT PLAN (select by exact id when one fits):",
    ...buildTopicLines(topics),
    "",
    "The latest user message starts with a BRIEF SO FAR block: the current saved",
    "state of the brief, refreshed automatically every turn. Trust it over your",
    "own memory of the conversation.",
    "",
    "DRIVE TO DONE, DON'T PAUSE BETWEEN STEPS:",
    "- Within a single turn, chain everything you can: update the brief, attach",
    "  or create a topic, then call generate_content, all in the same turn when",
    "  the user has given you enough to work with. Never stop just to say",
    "  \"okay, kicking this off\" or ask permission for a step you're already",
    "  equipped to take.",
    "- Call generate_content the moment the brief has a goal, a key message, and",
    "  a topic attached. It generates the draft and opens it immediately, so",
    "  only call it when you mean it, not speculatively.",
    "- Ask a clarifying question ONLY when you are genuinely blocked (nothing to",
    "  infer, no topic that fits, no way to proceed) and keep it to one question.",
    "",
    "HOW TO RUN THE FLOW:",
    "- On the FIRST turn, capture everything you can from what the user said:",
    "  call update_brief with the fields you can infer (goal, key_message,",
    "  audience_notes, angle, offer_slug). Never invent; omit what you can't tell.",
    "- Attach a topic in the same turn when possible: if a stored topic fits, call",
    "  select_topic with its exact id; otherwise propose a short working title in",
    "  your reply and call create_topic (you may also set its funnel_stage).",
    "- When 1 to 3 stored topics plausibly fit and the user hasn't pinned one",
    "  down, call suggest_options with those topics (kind: \"topic\", id = exact id,",
    "  label = the title) so they can tap instead of type.",
    "- The user edits the brief in the UI by tapping rows; their edit arrives as a",
    "  short instruction like \"change the goal to X\". Apply it with update_brief.",
    "",
    "RECALLING PAST CONTENT:",
    "- If the user references something already made (\"what did we send",
    "  recently\", \"pull up last week's newsletter\"), call list_recent_content",
    "  before answering; call get_content on a specific id if they want detail.",
    "- \"Turn that into a blog\" or similar, about an existing email, means",
    "  create_blog_from_email with that email's id, not a fresh brief.",
    "",
    "MEMORY:",
    "- When the user states a durable preference, decision, or constraint that",
    "  should hold beyond this one piece (not something already in the brand",
    "  voice or guidelines above), call remember to save it for next time.",
    "- If they say a remembered fact is wrong or no longer true, call forget",
    "  with its id from THINGS YOU'VE LEARNED.",
    "",
    "- Keep replies short. One brief card plus a sentence or two is the ceiling.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Opening line shown before the first user message (empty state). */
export const CREATE_AGENT_GREETING = "What are we creating today?";
