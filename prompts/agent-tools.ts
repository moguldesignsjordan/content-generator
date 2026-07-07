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

export interface PlanSeriesItem {
  title: string;
  topic_id?: string;
  angle?: string;
  key_message?: string;
  offer_slug?: string;
  email_type?: "newsletter" | "product" | "service" | "promotional" | "announcement";
  funnel_stage?: "awareness" | "consideration" | "decision" | "brand";
}

export interface PlanSeriesInput {
  items: PlanSeriesItem[];
}

/**
 * The multi-email counterpart to generate_content: creates every draft in a
 * campaign series (one per item) as instant shells that each write themselves
 * when opened. Per-item angle/message/offer land in meta.series_brief so the
 * emails don't all flatten onto the one shared campaign brief.
 */
export const PLAN_SERIES_TOOL: Anthropic.Tool = {
  name: "plan_series",
  description:
    "Create a whole multi-email campaign series at once (2 to 10 emails), e.g. " +
    "one email per product, or a run of newsletters on different topics. Call " +
    "it ONCE with every email in the series, and only after the user has agreed " +
    "to the plan you proposed in a reply. Each item becomes its own draft that " +
    "the user reviews, approves, and schedules individually; drafts appear " +
    "instantly and each one writes itself when opened.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: 2,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Working title / subject direction for this email.",
            },
            topic_id: {
              type: "string",
              description:
                "Exact id of an existing topic from the TOPICS list to reuse. " +
                "Omit to create a new topic from the title.",
            },
            angle: {
              type: "string",
              description: "The hook or angle for THIS email specifically.",
            },
            key_message: {
              type: "string",
              description: "The one thing THIS email must land.",
            },
            offer_slug: {
              type: "string",
              description:
                "Slug of the product/offer THIS email promotes, from the " +
                "PRODUCTS list. Product campaigns: one per email.",
            },
            email_type: {
              type: "string",
              enum: ["newsletter", "product", "service", "promotional", "announcement"],
              description:
                "Optional purpose/length override for this email. Omit to derive it.",
            },
            funnel_stage: {
              type: "string",
              enum: ["awareness", "consideration", "decision", "brand"],
              description: "Funnel stage this email serves, if a new topic is created.",
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["items"],
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
  PLAN_SERIES_TOOL,
  LIST_RECENT_CONTENT_TOOL,
  GET_CONTENT_TOOL,
  CREATE_BLOG_FROM_EMAIL_TOOL,
  REMEMBER_TOOL,
  FORGET_TOOL,
];
