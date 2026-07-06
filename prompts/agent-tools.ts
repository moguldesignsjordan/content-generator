import type { Anthropic } from "@anthropic-ai/sdk";

// Tools exclusive to the dashboard create agent (app/api/create/chat/route.ts):
// auto-generate, recall of past content, and durable brand memory. Kept apart
// from prompts/campaign.ts, whose tool set (update_brief, select_topic,
// create_topic, suggest_options, start_generation, propose_voice_updates) is
// shared with the older campaign-interview surface (app/api/campaigns/chat) —
// none of these six are relevant there, so they don't belong in that file.

export interface GenerateContentInput {
  channel: "email" | "blog";
  email_type?: "newsletter" | "product" | "service" | "promotional" | "announcement";
  blog_type?: "pillar" | "how_to" | "listicle" | "case_study" | "thought_leadership" | "landing";
}

/**
 * Replaces the old start_generation (which only flipped a "ready" flag for a
 * human to click Generate): this one actually creates the draft shell and
 * hands back a draftId the route surfaces so the client can navigate straight
 * to the review screen. Real generation still streams later on that page.
 */
export const GENERATE_CONTENT_TOOL: Anthropic.Tool = {
  name: "generate_content",
  description:
    "Call ONCE the brief has a goal and key message and a topic is attached, to " +
    "generate the draft right now. This creates the draft and opens it " +
    "immediately, there is no further confirmation step, so only call it when " +
    "you're actually ready to hand off, not preemptively or mid-clarification.",
  input_schema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: ["email", "blog"],
        description: "Which pipeline to generate into.",
      },
      email_type: {
        type: "string",
        enum: ["newsletter", "product", "service", "promotional", "announcement"],
        description:
          "Optional override for the email's purpose/length budget. Omit to let generation derive it from the topic.",
      },
      blog_type: {
        type: "string",
        enum: ["pillar", "how_to", "listicle", "case_study", "thought_leadership", "landing"],
        description:
          "Optional override for the blog post's format/length budget. Omit to let generation derive it from the topic.",
      },
    },
    required: ["channel"],
  },
};

export interface ListRecentContentInput {
  job_type?: "email" | "blog";
}

export const LIST_RECENT_CONTENT_TOOL: Anthropic.Tool = {
  name: "list_recent_content",
  description:
    "List recently created drafts, newest first, with their id, subject, type, " +
    "and state. Use this when the user references past content (\"what did we " +
    "send recently\", \"pull up last week's newsletter\") before you can answer " +
    "or act on it.",
  input_schema: {
    type: "object",
    properties: {
      job_type: {
        type: "string",
        enum: ["email", "blog"],
        description: "Optional: scope to only emails or only blog posts. Omit to see everything.",
      },
    },
  },
};

export interface GetContentInput {
  draft_id: string;
}

export const GET_CONTENT_TOOL: Anthropic.Tool = {
  name: "get_content",
  description:
    "Get the full detail (subject, state, topic) of one past draft by its id. " +
    "Use the id from list_recent_content's results, never a guessed one.",
  input_schema: {
    type: "object",
    properties: {
      draft_id: { type: "string", description: "The draft's id, from list_recent_content." },
    },
    required: ["draft_id"],
  },
};

export interface CreateBlogFromEmailInput {
  source_draft_id: string;
}

export const CREATE_BLOG_FROM_EMAIL_TOOL: Anthropic.Tool = {
  name: "create_blog_from_email",
  description:
    "Turn an existing email draft into a blog post on the same topic, e.g. " +
    "\"turn that into a blog\" or \"make a post out of last week's email\". " +
    "Creates and opens a new blog draft; if one already exists for that email " +
    "it reuses it instead of duplicating. Use the email's id from " +
    "list_recent_content, never a guessed one.",
  input_schema: {
    type: "object",
    properties: {
      source_draft_id: {
        type: "string",
        description: "The id of the existing EMAIL draft to spin a blog post off of.",
      },
    },
    required: ["source_draft_id"],
  },
};

export interface RememberInput {
  content: string;
  kind?: string;
}

export const REMEMBER_TOOL: Anthropic.Tool = {
  name: "remember",
  description:
    "Save a durable fact about this account for every future session: a " +
    "preference the user stated, a decision they made, a constraint they gave. " +
    "Not for ephemeral chit-chat, and not for anything already covered by the " +
    "stored brand voice or guidelines.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The fact, written as one short, clear, self-contained statement.",
      },
      kind: {
        type: "string",
        description: "A short free-text label, e.g. \"preference\", \"constraint\", \"decision\". Optional.",
      },
    },
    required: ["content"],
  },
};

export interface ForgetInput {
  memory_id: string;
}

export const FORGET_TOOL: Anthropic.Tool = {
  name: "forget",
  description:
    "Remove a previously learned fact, e.g. when the user says it's no longer " +
    "true or corrects it. Use the id shown next to it in THINGS YOU'VE LEARNED, " +
    "never a guessed one.",
  input_schema: {
    type: "object",
    properties: {
      memory_id: { type: "string", description: "The id of the learned fact to remove." },
    },
    required: ["memory_id"],
  },
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  GENERATE_CONTENT_TOOL,
  LIST_RECENT_CONTENT_TOOL,
  GET_CONTENT_TOOL,
  CREATE_BLOG_FROM_EMAIL_TOOL,
  REMEMBER_TOOL,
  FORGET_TOOL,
];
