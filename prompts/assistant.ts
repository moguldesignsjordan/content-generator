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
 * The one tool the assistant can call: kick off a full email draft for a topic.
 * The route creates a draft shell (createDraftShell) and returns its id
 * immediately; the model never writes directly. The actual writing happens
 * in the background once the user opens the draft page, which streams real
 * progress instead of the assistant waiting on it.
 */
export const GENERATE_EMAIL_TOOL: Anthropic.Tool = {
  name: "generate_email",
  description:
    "Start a full on-brand email draft for one topic. Call this when the user " +
    "asks you to write, draft, or generate an email. Pass the exact topicId from " +
    "the TOPICS list. Returns a draft id immediately; the email is written in the " +
    "background as soon as the user opens the draft, which takes about 30 to 90 seconds.",
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
    "- After you call it you'll be told the new draft id right away. Tell the user " +
      "it's being written and they can open it now to watch it come together.",
    "- Keep replies short and scannable. No long preambles.",
    "- You can also suggest subject lines, critique copy, and answer brand/strategy " +
      "questions using the context above.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
  ].join("\n");
}
