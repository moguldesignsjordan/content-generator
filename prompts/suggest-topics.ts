import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand, Icp, Product, Strategy } from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildFunnelBlock,
  buildGuidelinesBlock,
  buildPositioningBlock,
  buildProductLines,
} from "./brand-voice";

// Starter-topic suggestions: turns the brand brain into 5-8 concrete email
// ideas so a fresh brand has a content plan without authoring a strategy doc.
// The route returns them as PROPOSALS; the user picks which to add.

export interface TopicIdeaInput {
  title?: string;
  target_keyword?: string;
  intent?: string;
  funnel_stage?: "awareness" | "consideration" | "decision" | "brand";
  maps_to_product?: string;
}

export interface SuggestTopicsToolInput {
  topics?: TopicIdeaInput[];
}

export const SUGGEST_TOPICS_TOOL: Anthropic.Tool = {
  name: "save_topic_ideas",
  description:
    "Return 5 to 8 email topic ideas grounded in the brand data provided. " +
    "Each is one sendable email, specific enough to draft from the title alone.",
  input_schema: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "The email's working title, concrete and specific, in the brand's vocabulary. Never generic filler like 'Tips and tricks'.",
            },
            target_keyword: {
              type: "string",
              description: "A natural search keyword this topic serves, if one fits.",
            },
            intent: {
              type: "string",
              description: "Reader intent, e.g. informational, commercial.",
            },
            funnel_stage: {
              type: "string",
              enum: ["awareness", "consideration", "decision", "brand"],
              description: "The funnel stage this email serves.",
            },
            maps_to_product: {
              type: "string",
              description:
                "Slug of the offer this topic naturally sells, ONLY from the PRODUCTS list. Omit when none fits.",
            },
          },
          required: ["title", "funnel_stage"],
        },
      },
    },
    required: ["topics"],
  },
};

/** Builds the (system, user) pair for one topic-suggestion call. */
export function buildSuggestTopicsMessages(args: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
  products: Product[];
  existingTitles: string[];
}): { system: string; user: string } {
  const { brand, strategy, primaryIcp, products, existingTitles } = args;

  const system = [
    `You are the content strategist for ${brand.name}. You propose email topics`,
    "the brand can send to its list: useful to the audience, on-strategy, and",
    "each one clearly sellable toward an offer where it fits naturally.",
    "",
    buildGuidelinesBlock(brand),
    buildBrandVoiceBlock(brand, primaryIcp, "email"),
    buildPositioningBlock(brand),
    "",
    "RULES:",
    "- Ground every idea in the brand data above; never invent services the brand doesn't offer.",
    "- Mix funnel stages: mostly awareness/consideration value, 1-2 decision-stage ideas.",
    "- maps_to_product only when the topic genuinely leads to that offer.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
    "- Call save_topic_ideas once with 5 to 8 ideas.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    "Propose email topic ideas for the brand.",
    "",
    "PRODUCTS (for maps_to_product, by slug):",
    ...buildProductLines(products),
    "",
    "FUNNEL → CTA MAPPING:",
    buildFunnelBlock(strategy),
    "",
    existingTitles.length
      ? [
          "TOPICS ALREADY ON THE PLAN (do not duplicate or closely mirror):",
          ...existingTitles.slice(0, 40).map((t) => `  - ${t}`),
        ].join("\n")
      : "The content plan is empty; these are the brand's first topics.",
    "",
    "Call save_topic_ideas with 5 to 8 ideas.",
  ].join("\n");

  return { system, user };
}
