import type { Anthropic } from "@anthropic-ai/sdk";

// Tools exclusive to the dashboard create agent (app/api/create/chat/route.ts):
// auto-generate, recall of past content, competitor-ad capture, and durable
// brand memory. Kept apart from prompts/campaign.ts, whose tool set
// (update_brief, select_topic, create_topic, suggest_options,
// start_generation, propose_voice_updates) is still imported by
// create-agent.ts even though the older standalone campaign-interview route
// has been removed — none of these tools are relevant there, so they don't
// belong in that file.

export interface GenerateContentInput {
  channel: "email" | "blog" | "social";
  email_type?: "newsletter" | "product" | "service" | "promotional" | "announcement";
  blog_type?: "pillar" | "how_to" | "listicle" | "case_study" | "thought_leadership" | "landing";
  flyer_aspect?: "1:1" | "4:5" | "9:16";
  social_format?: "post" | "ad";
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
    "generate the draft right now. This creates the draft and it starts " +
    "generating as a live preview in the chat, there is no further " +
    "confirmation step, so only call it when you're actually ready, not " +
    "preemptively or mid-clarification. Changes to a piece already ON SCREEN " +
    "go through edit_flyer or revise_piece instead.",
  input_schema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: ["email", "blog", "social"],
        description:
          "Which pipeline to generate into. \"social\" is a standalone image " +
          "(a social media flyer) built from the brief and topic.",
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
      flyer_aspect: {
        type: "string",
        enum: ["1:1", "4:5", "9:16"],
        description:
          "Shape of a social image (channel \"social\" only): 1:1 square post, " +
          "4:5 feed portrait, 9:16 story/reel. Defaults to 1:1.",
      },
      social_format: {
        type: "string",
        enum: ["post", "ad"],
        description:
          "Channel \"social\" only. \"ad\" when the user wants a paid Facebook or " +
          "Instagram ad (writes primary text, headline, description, and a CTA " +
          "button); \"post\" for an organic post with a caption. Infer it from " +
          "their wording (\"an ad for...\", \"boost\", \"run ads\"); never ask. " +
          "Defaults to post.",
      },
    },
    required: ["channel"],
  },
};

export interface StartCampaignInput {
  summary: string;
  kinds?: ("social" | "ad" | "email" | "blog")[];
  size?: number;
  days?: number;
  research?: boolean;
}

/**
 * Ends a campaign conversation: the summary becomes the factory's one-line
 * description, which feeds the plan and every piece's brief. The client runs
 * the planner with these settings and opens the editable plan.
 */
export const START_CAMPAIGN_TOOL: Anthropic.Tool = {
  name: "start_campaign",
  description:
    "Call ONCE, only for a campaign, after the user confirms your one-line " +
    "recap. Hands the campaign to the planner, which builds an editable plan " +
    "of every piece. Never call generate_content for a campaign.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Under 500 characters, plain words: what the campaign promotes and " +
          "every real detail the user gave (offer, price, deadline, who it's " +
          "for, a real result, what to do with their photos). Never invent one.",
      },
      kinds: {
        type: "array",
        items: { type: "string", enum: ["social", "ad", "email", "blog"] },
        description:
          "What the campaign includes: social posts, paid ads, emails, blog posts. " +
          "All four when they said everything or didn't care.",
      },
      size: {
        type: "integer",
        enum: [6, 12, 20],
        description: "How many pieces. 12 when they didn't say.",
      },
      days: {
        type: "integer",
        enum: [14, 30],
        description: "Spread over 14 or 30 days. 30 when they didn't say.",
      },
      research: {
        type: "boolean",
        description:
          "True ONLY when the user said yes to researching the web first. " +
          "False when they said no or were never asked.",
      },
    },
    required: ["summary", "research"],
  },
};

/** Shows the design-look picker under the reply, so the user can pick one of
 * their saved looks (example ads) for a flyer to follow. */
export const SHOW_LOOK_PICKER_TOOL: Anthropic.Tool = {
  name: "show_look_picker",
  description:
    "For a flyer only: shows their saved looks (example ads to follow) under " +
    "your reply so they can tap one. Call it in the same turn you ask about " +
    "the feel. Their pick arrives as their next message.",
  input_schema: { type: "object", properties: {} },
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

export interface CreateFlyerFromEmailInput {
  source_draft_id: string;
}

export const CREATE_FLYER_FROM_EMAIL_TOOL: Anthropic.Tool = {
  name: "create_flyer_from_email",
  description:
    "Turn an existing email draft into a matching social media flyer (an image " +
    "post on the same topic), e.g. when the user says yes to \"want a matching " +
    "flyer for this?\" or asks for a social post about an email. Creates and " +
    "opens a new flyer draft; if one already exists for that email it reuses it " +
    "instead of duplicating. Use the email's real draft id, never a guessed one.",
  input_schema: {
    type: "object",
    properties: {
      source_draft_id: {
        type: "string",
        description: "The id of the existing EMAIL draft to build the flyer from.",
      },
    },
    required: ["source_draft_id"],
  },
};

export interface SaveCompetitorReferenceInput {
  name: string;
  input_kind: "text" | "image";
  content?: string;
  image_url?: string;
  source_url?: string;
}

/**
 * Saves a competitor ad to the swipe file (competitor_references, migration
 * 025) and distills its marketing STRATEGY once, so it can be picked for
 * future emails via update_brief.competitor_reference_id. The DB write and
 * Claude distillation both happen here (like remember), unlike update_brief's
 * pure state merge.
 */
export const SAVE_COMPETITOR_REFERENCE_TOOL: Anthropic.Tool = {
  name: "save_competitor_reference",
  description:
    "Save a competitor ad the user wants to learn the STRATEGY from (never " +
    "copy). Call this the moment they paste ad copy, attach a screenshot of " +
    "an ad, or share a URL to one, framed as an example, inspiration, or " +
    "something they want to learn from (not a link about their own brand). " +
    "Distills the hook/angle/structure/CTA once; follow up with update_brief " +
    "setting competitor_reference_id to the id this returns.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "A short name for this ad, e.g. the competitor's name or the ad's hook.",
      },
      input_kind: {
        type: "string",
        enum: ["text", "image"],
        description: "\"text\" for pasted or scraped ad copy, \"image\" for an attached screenshot.",
      },
      content: {
        type: "string",
        description:
          "The ad's copy VERBATIM, when input_kind is \"text\": exactly as pasted, " +
          "or exactly as it appeared in a system note after a URL was scraped.",
      },
      image_url: {
        type: "string",
        description:
          "The EXACT URL of the attached screenshot, when input_kind is \"image\", " +
          "verbatim from the attached-image list on the user's message. NEVER invent one.",
      },
      source_url: {
        type: "string",
        description: "Where this ad was seen, if the user gave a URL.",
      },
    },
    required: ["name", "input_kind"],
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

export interface RevisePieceInput {
  feedback: string;
}

/** Changes to the flyer ON SCREEN; the chat's preview card applies them. */
export const EDIT_FLYER_TOOL: Anthropic.Tool = {
  name: "edit_flyer",
  description:
    "Change the flyer that's ON SCREEN in the chat's live preview. Use it for " +
    "any change the owner asks for on that flyer: switch to another option, " +
    "change its text, change what the art shows, put a photo from this chat " +
    "into the design (or copy a photo's style), or re-render it on the Pro " +
    "image model. Pass only what changes. The preview updates on its own.",
  input_schema: {
    type: "object",
    properties: {
      option: { type: "integer", description: "Switch to this option number (1-based)." },
      headline: { type: "string", description: "New headline, exactly as it should appear." },
      subtext: { type: "string", description: "New supporting line; empty string removes it." },
      cta: { type: "string", description: "New call to action; empty string removes it." },
      scene: { type: "string", description: "What the art should show instead, described visually." },
      photo_url: {
        type: "string",
        description: "Exact URL of a photo attached in this chat, to put in the design or copy the style of.",
      },
      photo_use: {
        type: "string",
        enum: ["place", "style"],
        description: "place: add the photo's subject into the design (default). style: redraw in the photo's style.",
      },
      note: { type: "string", description: "For place: where or how it goes, in their words." },
      pro: { type: "boolean", description: "Re-render the current option on the Pro image model." },
    },
  },
};

/** A new version of the piece ON SCREEN, rewritten with the owner's notes. */
export const REVISE_PIECE_TOOL: Anthropic.Tool = {
  name: "revise_piece",
  description:
    "Rewrite the piece ON SCREEN as a new version with the owner's notes: any " +
    "change to an email or blog post, or a flyer that needs new copy and new " +
    "options rather than a tweak. The preview shows the new version when it's " +
    "ready. Not for a different piece: that's generate_content.",
  input_schema: {
    type: "object",
    properties: {
      feedback: {
        type: "string",
        description: "What to change, specific and in the owner's own words.",
      },
    },
    required: ["feedback"],
  },
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  GENERATE_CONTENT_TOOL,
  EDIT_FLYER_TOOL,
  REVISE_PIECE_TOOL,
  START_CAMPAIGN_TOOL,
  SHOW_LOOK_PICKER_TOOL,
  LIST_RECENT_CONTENT_TOOL,
  GET_CONTENT_TOOL,
  CREATE_BLOG_FROM_EMAIL_TOOL,
  CREATE_FLYER_FROM_EMAIL_TOOL,
  SAVE_COMPETITOR_REFERENCE_TOOL,
  REMEMBER_TOOL,
  FORGET_TOOL,
];
