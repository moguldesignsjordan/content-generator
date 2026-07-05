import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  Brand,
  CampaignBrief,
  Icp,
  Product,
  Strategy,
} from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildGuidelinesBlock,
  buildPositioningBlock,
} from "./brand-voice";
// The create agent reuses the campaign interview's tool surface verbatim. The
// only difference is curation: the streamlined create flow deliberately drops
// propose_voice_updates so a casual "what are we creating today?" can never
// mutate the durable brand voice profile. Importing the shared tool defs (and
// their input types) keeps the two surfaces from drifting apart.
import {
  CREATE_TOPIC_TOOL,
  SELECT_TOPIC_TOOL,
  START_GENERATION_TOOL,
  SUGGEST_OPTIONS_TOOL,
  UPDATE_BRIEF_TOOL,
  type CampaignTopicOption,
} from "./campaign";

// Re-export the input types the route needs to cast tool_use blocks against.
export type {
  CampaignTopicOption,
  CreateTopicInput,
  SelectTopicInput,
  SuggestedOption,
  SuggestOptionsInput,
  UpdateBriefInput,
} from "./campaign";

/**
 * The curated toolset for the dashboard create agent. Same shape as the
 * campaign interview minus voice proposals: the agent can fill a brief, attach
 * (or create) a topic, offer tappable options, and hand off to generation.
 */
export const CREATE_TOOLS: Anthropic.Tool[] = [
  UPDATE_BRIEF_TOOL,
  SELECT_TOPIC_TOOL,
  CREATE_TOPIC_TOOL,
  SUGGEST_OPTIONS_TOOL,
  START_GENERATION_TOOL,
];

/**
 * Builds the system prompt for one create-agent turn. The agent reads the
 * stored brand brain and turns the user's freeform "what are we creating
 * today?" into a tight email brief, then hands off. Brief-then-confirm: it
 * infers what it can and asks at most one clarifying question, never runs a
 * long serial interview.
 */
export function buildCreateAgentSystem(args: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
  products: Product[];
  topics: CampaignTopicOption[];
  brief: CampaignBrief;
  topicId: string | null;
}): string {
  const { brand, strategy, primaryIcp, products, topics, brief, topicId } = args;

  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, primaryIcp, "email");
  const positioningBlock = buildPositioningBlock(brand);

  const productLines = products.length
    ? products.map(
        (p) =>
          `  - ${p.slug}: ${p.name}${p.price_point ? ` (${p.price_point})` : ""}${p.description ? `, ${p.description}` : ""}`,
      )
    : ["  (none on file)"];

  const topicLines = topics.length
    ? topics
        .slice(0, 40)
        .map(
          (t) =>
            `  - id=${t.id} | ${t.title} | pillar: ${t.pillar}${t.funnel_stage ? ` | ${t.funnel_stage}` : ""} | ${t.status}`,
        )
    : ["  (none yet, you will need create_topic)"];

  const briefLines = [
    `  Goal: ${brief.goal ?? "(not set)"}`,
    `  Audience notes: ${brief.audience_notes ?? "(not set)"}`,
    `  Key message: ${brief.key_message ?? "(not set)"}`,
    `  Angle: ${brief.angle ?? "(not set)"}`,
    `  Offer: ${brief.offer_slug ?? "(not set)"}`,
    `  Constraints: ${brief.constraints ?? "(none)"}`,
    `  Topic attached: ${topicId ? "yes" : "no"}`,
  ];

  const funnel = strategy?.funnel_definition
    ? Object.entries(strategy.funnel_definition)
        .map(([stage, def]) => `  ${stage} → ${def.cta_type}`)
        .join("\n")
    : "  (default)";

  return [
    `You are the content creation agent for ${brand.name}. The user opened with`,
    "what they want to make today; your job is to turn that into a tight email",
    "brief and hand off to generation. You are warm, sharp, and concise, like a",
    "trusted collaborator who already knows the brand cold.",
    "",
    "You run a BRIEF-THEN-CONFIRM flow, not a long interview. You already know",
    "everything below, so INFER freely and ask at most ONE clarifying question,",
    "and only when something is genuinely ambiguous and un-inferrable.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    "",
    "FUNNEL STAGES AND THEIR CTAs (pick the funnel_stage that matches the goal):",
    funnel,
    "",
    "PRODUCTS (reference by slug in update_brief.offer_slug):",
    ...productLines,
    "",
    "TOPICS ON THE CONTENT PLAN (select by exact id when one fits):",
    ...topicLines,
    "",
    "BRIEF SO FAR:",
    ...briefLines,
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
    "- Call start_generation ONCE the brief has a goal and a key message AND a",
    "  topic is attached. Then tell them the draft is on its way.",
    "- Always reply with a normal conversational message; never a bare tool call.",
    "- Keep replies short. One brief card plus a sentence or two is the ceiling.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Opening line shown before the first user message (empty state). */
export const CREATE_AGENT_GREETING = "What are we creating today?";
