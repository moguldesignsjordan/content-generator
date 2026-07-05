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

// The campaign interview: a strategist chat that gathers a brief for one piece
// of content, picks (or creates) the topic it hangs off, and learns voice
// traits along the way. All writes happen in the route via tools; voice
// learnings are only PROPOSED, the human confirms before anything is saved.

export interface UpdateBriefInput {
  goal?: string;
  audience_notes?: string;
  key_message?: string;
  offer_slug?: string;
  angle?: string;
  constraints?: string;
}

export interface SelectTopicInput {
  topic_id: string;
}

export interface CreateTopicInput {
  title: string;
  target_keyword?: string;
  intent?: string;
  funnel_stage?: "awareness" | "consideration" | "decision" | "brand";
}

export interface VoiceProposals {
  voice?: string;
  tone?: string;
  banned_terms_add?: string[];
  example_lines?: string[];
  note?: string;
}

/** The topic rows the interview can suggest from (id + display context). */
export interface CampaignTopicOption {
  id: string;
  title: string;
  pillar: string;
  funnel_stage: string | null;
  status: string;
}

export const UPDATE_BRIEF_TOOL: Anthropic.Tool = {
  name: "update_brief",
  description:
    "Save campaign-brief fields you have just learned from the user's answer. " +
    "Pass ONLY fields the user clearly gave you this turn; never invent.",
  input_schema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "What this campaign should achieve (the outcome the user wants).",
      },
      audience_notes: {
        type: "string",
        description: "Who this piece is for, beyond the stored ICP (segment, situation).",
      },
      key_message: {
        type: "string",
        description: "The one thing the reader must take away.",
      },
      offer_slug: {
        type: "string",
        description: "Slug of the product/offer this campaign promotes, from the PRODUCTS list.",
      },
      angle: { type: "string", description: "The hook or angle for this piece." },
      constraints: {
        type: "string",
        description: "Anything to avoid or must-include the user mentioned.",
      },
    },
  },
};

export const SELECT_TOPIC_TOOL: Anthropic.Tool = {
  name: "select_topic",
  description:
    "Attach the campaign to an existing topic from the TOPICS list once the user " +
    "agrees it fits. Pass the topic's exact id.",
  input_schema: {
    type: "object",
    properties: {
      topic_id: { type: "string", description: "The id of the chosen topic." },
    },
    required: ["topic_id"],
  },
};

export const CREATE_TOPIC_TOOL: Anthropic.Tool = {
  name: "create_topic",
  description:
    "Create a NEW topic when no existing topic fits the campaign and the user has " +
    "agreed to the new title. Prefer select_topic when a stored topic fits.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The topic/working title." },
      target_keyword: { type: "string", description: "Target keyword if discussed." },
      intent: {
        type: "string",
        description: "Search/content intent, e.g. informational, commercial.",
      },
      funnel_stage: {
        type: "string",
        enum: ["awareness", "consideration", "decision", "brand"],
        description: "Funnel stage this piece serves.",
      },
    },
    required: ["title"],
  },
};

export const PROPOSE_VOICE_TOOL: Anthropic.Tool = {
  name: "propose_voice_updates",
  description:
    "Propose additions to the durable brand voice profile based on things you " +
    "learned in this conversation (how they talk, phrases they used and liked, " +
    "words they hate). These are PROPOSALS: the user sees a confirm card and " +
    "decides. Never treat them as saved.",
  input_schema: {
    type: "object",
    properties: {
      voice: {
        type: "string",
        description: "A refined description of how the brand sounds, if you learned one.",
      },
      tone: { type: "string", description: "A refined tone description, if learned." },
      banned_terms_add: {
        type: "array",
        items: { type: "string" },
        description: "Words/phrases the user said they never want used.",
      },
      example_lines: {
        type: "array",
        items: { type: "string" },
        description:
          "Lines the user actually wrote or explicitly approved in this chat, worth keeping as voice examples.",
      },
      note: {
        type: "string",
        description: "One short line telling the user why you're proposing this.",
      },
    },
  },
};

export const START_GENERATION_TOOL: Anthropic.Tool = {
  name: "start_generation",
  description:
    "Call when the brief has a goal and key message, a topic is attached, and the " +
    "user has confirmed they're ready. This hands off to email generation.",
  input_schema: { type: "object", properties: {} },
};

export interface SuggestedOption {
  id: string;
  label: string;
  kind: "topic" | "action";
}

export interface SuggestOptionsInput {
  options: SuggestedOption[];
}

export const SUGGEST_OPTIONS_TOOL: Anthropic.Tool = {
  name: "suggest_options",
  description:
    "Offer the user tappable quick-reply options instead of making them retype a " +
    "title. Call this whenever you have fitting topics to suggest from the TOPICS " +
    "list, or a clear next-step action to offer. Always pair it with a normal " +
    "conversational message in the same turn, never a bare tool call.",
  input_schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "For kind=\"topic\": the exact topic id from the TOPICS list, never " +
                "invented. For kind=\"action\": a short slug you make up for this " +
                "action, e.g. \"new_topic\".",
            },
            label: {
              type: "string",
              description:
                "The human-readable text on the chip, e.g. the topic's title, or the " +
                "action's plain-language name.",
            },
            kind: {
              type: "string",
              enum: ["topic", "action"],
              description:
                "\"topic\" when id is a real topic from the list, \"action\" for " +
                "anything else tappable (e.g. proposing a brand-new topic).",
            },
          },
          required: ["id", "label", "kind"],
        },
      },
    },
    required: ["options"],
  },
};

export const CAMPAIGN_TOOLS: Anthropic.Tool[] = [
  UPDATE_BRIEF_TOOL,
  SELECT_TOPIC_TOOL,
  CREATE_TOPIC_TOOL,
  PROPOSE_VOICE_TOOL,
  START_GENERATION_TOOL,
  SUGGEST_OPTIONS_TOOL,
];

/**
 * Builds the system prompt for one campaign-interview turn: strategist persona,
 * the full stored brand context (so it only asks about what's missing), the
 * catalog of products and topics it can reference, and the brief so far.
 */
export function buildCampaignSystem(args: {
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

  const v = brand.voice_profile ?? {};
  const voiceIsThin =
    !v.voice || !(v.examples?.length || v.example_posts?.length);

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
    `You are the campaign strategist for ${brand.name}. The user is starting a new`,
    "email campaign, and your interview produces the brief that generation runs on.",
    "You are warm, sharp, and concise, like a senior strategist on a kickoff call.",
    "You already know everything below, so ask only about what you DON'T know.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    "",
    "FUNNEL → CTA MAPPING:",
    funnel,
    "",
    "PRODUCTS (reference by slug in update_brief.offer_slug):",
    ...productLines,
    "",
    "TOPICS ON THE CONTENT PLAN (suggest the best fits; select by id):",
    ...topicLines,
    "",
    "BRIEF SO FAR:",
    ...briefLines,
    "",
    "HOW TO RUN THE INTERVIEW:",
    "- Work toward: goal → audience/segment → key message and angle → offer → topic.",
    "- Ask ONE focused question at a time (two only when tightly related). Short turns.",
    "- Acknowledge answers briefly and specifically; never re-ask what's stored or in the brief.",
    "- When an answer gives brief data, call update_brief with exactly those fields.",
    "- Once you understand the goal, call suggest_options with 1 to 3 fitting topics",
    "  from the list (kind: \"topic\", id = the topic's exact id, label = its title) so",
    "  the user can tap one instead of typing it out. When the user picks one (by tap",
    "  or by typing its title), call select_topic. If nothing on the list fits, suggest",
    "  a new title in your reply and call create_topic once they agree to it.",
    ...(voiceIsThin
      ? [
          "- The stored voice profile is THIN. Weave in one voice question when natural",
          "  (e.g. ask them to say the key message in their own words, or what phrasing",
          "  they'd never use). When you learn something durable, call propose_voice_updates.",
        ]
      : [
          "- If the user reveals durable voice preferences (phrases they love or hate),",
          "  call propose_voice_updates so they can keep them.",
        ]),
    "- propose_voice_updates only PROPOSES; the user confirms in the UI. Never claim it's saved.",
    "- When the brief has a goal and key message, a topic is attached, and the user says",
    "  they're ready, call start_generation and tell them the draft is on its way.",
    "- Always reply with a normal conversational message; never a bare tool call.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Opening line shown before the first user message. */
export const CAMPAIGN_GREETING =
  "Let's build this campaign. First things first: what are you trying to make happen " +
  "with this email? A booked call, signups, buzz for something new?";
