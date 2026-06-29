import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand, Icp } from "@/lib/db/types";
import { buildBrandVoiceBlock, buildPositioningBlock } from "./brand-voice";

export interface AssistantTopic {
  id: string;
  title: string;
  status: string;
  funnel_stage: string | null;
}

/**
 * The one tool the assistant can call: generate a full email draft for a topic.
 * The route executes the real pipeline (generateEmailForTopic); the model never
 * writes directly. The route returns the new draft id so the assistant can tell
 * the user where to review it.
 */
export const GENERATE_EMAIL_TOOL: Anthropic.Tool = {
  name: "generate_email",
  description:
    "Generate a full on-brand email draft for one topic. Call this when the user " +
    "asks you to write, draft, or generate an email. Pass the exact topicId from " +
    "the TOPICS list. Generation takes about 30 to 90 seconds and returns the new " +
    "draft id.",
  input_schema: {
    type: "object",
    properties: {
      topicId: {
        type: "string",
        description: "The id of the topic to generate an email for, from the TOPICS list.",
      },
    },
    required: ["topicId"],
  },
};

/** Builds the assistant's system prompt: role, brand brain, topic list, rules. */
export function buildAssistantSystem(
  brand: Brand,
  icp: Icp | null,
  topics: AssistantTopic[],
): string {
  const voiceBlock = buildBrandVoiceBlock(brand, icp);
  const positioningBlock = buildPositioningBlock(brand);
  const topicLines = topics.length
    ? topics
        .map(
          (t) =>
            `  - ${t.id} | ${t.title}${t.funnel_stage ? ` (${t.funnel_stage})` : ""} [${t.status}]`,
        )
        .join("\n")
    : "  (no topics yet, suggest the user add one in the Create tab)";

  return [
    `You are the Mogul content assistant for ${brand.name}. You help the brand owner ` +
      "create and improve on-brand marketing emails, and answer questions about their " +
      "brand and content strategy. You are concise, direct, and capable, like a sharp " +
      "editorial partner. You talk to founders as a peer.",
    "",
    voiceBlock,
    positioningBlock,
    "",
    "TOPICS the engine can generate emails for (id | title | funnel stage | status):",
    topicLines,
    "",
    "RULES:",
    "- To generate an email, call the generate_email tool with the topic's id. Only use " +
      "ids from the TOPICS list above, never invent one.",
    "- If the user's request is vague, suggest 2 to 3 matching topics by title and ask " +
      "which one to draft.",
    "- After generation completes you'll be told the new draft id. Tell the user the " +
      "draft is ready and that they can open it to review and approve.",
    "- Keep replies short and scannable. No long preambles.",
    "- You can also suggest subject lines, critique copy, and answer brand/strategy " +
      "questions using the context above.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
  ].join("\n");
}
