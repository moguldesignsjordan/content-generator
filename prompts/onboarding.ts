import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand } from "@/lib/db/types";
import { buildBrandVoiceBlock, buildPositioningBlock } from "./brand-voice";

// The flat shape the model passes to `save_brand_profile`. Flat (not nested)
// is easier for the model to fill reliably. All fields optional, pass only
// what the user has just confirmed this turn.
export interface OnboardingToolInput {
  name?: string;
  business_description?: string;
  tagline?: string;
  differentiators?: string[];
  competitors?: string[];
  voice?: string;
  tone?: string;
  banned_terms?: string[];
  sender_name?: string;
  sender_email?: string;
  icp_label?: string;
  icp_demographics?: string;
  icp_pains?: string[];
  icp_vocabulary?: string[];
  icp_jobs?: string[];
  icp_objections?: string[];
  auto_images?: boolean;
  complete?: boolean;
}

/**
 * The tool the onboarding agent calls to save profile data it has extracted.
 * The route executes it (writes to the DB), the model never writes directly.
 * `complete: true` signals onboarding is finished.
 */
export const ONBOARDING_TOOL: Anthropic.Tool = {
  name: "save_brand_profile",
  description:
    "Save brand-profile fields you have just confirmed from the user's answer. " +
    "Pass ONLY the fields the user has clearly given you this turn (don't guess). " +
    "Set complete=true once you have gathered: name, what they do, tagline, " +
    "differentiators, competitors, ideal customer, voice/tone, sender info, " +
    "and the auto-images preference.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Brand or business name." },
      business_description: {
        type: "string",
        description: "2-3 sentences on what the business does and for whom.",
      },
      tagline: { type: "string", description: "A short tagline." },
      differentiators: {
        type: "array",
        items: { type: "string" },
        description: "What sets the business apart.",
      },
      competitors: {
        type: "array",
        items: { type: "string" },
        description: "Competitor names.",
      },
      voice: { type: "string", description: "How the brand sounds." },
      tone: { type: "string", description: "The brand's tone." },
      banned_terms: {
        type: "array",
        items: { type: "string" },
        description: "Words/phrases the brand never uses.",
      },
      sender_name: { type: "string", description: "Who emails appear from." },
      sender_email: { type: "string", description: "Reply-to email address." },
      icp_label: { type: "string", description: "A short label for the ideal customer." },
      icp_demographics: { type: "string", description: "Who the ideal customer is." },
      icp_pains: { type: "array", items: { type: "string" }, description: "Customer pains." },
      icp_vocabulary: {
        type: "array",
        items: { type: "string" },
        description: "Words the customer uses (their vocabulary, not jargon).",
      },
      icp_jobs: {
        type: "array",
        items: { type: "string" },
        description: "Jobs to be done for the customer.",
      },
      icp_objections: { type: "array", items: { type: "string" }, description: "Customer objections." },
      auto_images: {
        type: "boolean",
        description:
          "True if the user wants an on-brand image created automatically " +
          "with each new email/blog draft, false if they'd rather add images " +
          "themselves. They always review and approve before anything publishes.",
      },
      complete: {
        type: "boolean",
        description: "True once all onboarding topics are gathered.",
      },
    },
  },
};

/**
 * Builds the system prompt for one onboarding turn. Includes the interviewer
 * persona, the collection checklist, the rules, and a summary of what's
 * already in the profile (so the model asks only what's missing).
 */
export function buildOnboardingSystem(brand: Brand): string {
  const p = brand.positioning ?? {};
  const v = brand.voice_profile ?? {};
  const m = brand.mailerlite_config ?? {};

  const filled: string[] = [];
  if (brand.name) filled.push("name");
  if (p.business_description) filled.push("business_description");
  if (p.tagline) filled.push("tagline");
  if (p.differentiators?.length) filled.push("differentiators");
  if (p.competitors?.length) filled.push("competitors");
  if (v.voice) filled.push("voice");
  if (v.tone) filled.push("tone");
  if (m.sender_name) filled.push("sender_name");
  if (m.sender_email) filled.push("sender_email");
  const autoImages = brand.visual_identity?.image_gen?.auto;
  if (autoImages !== undefined) filled.push("auto_images");

  const currentProfile = [
    "CURRENT PROFILE (already collected, don't re-ask these unless you need to refine):",
    `  Name: ${brand.name || "(not set)"}`,
    `  Business description: ${p.business_description || "(not set)"}`,
    `  Tagline: ${p.tagline || "(not set)"}`,
    `  Differentiators: ${p.differentiators?.join("; ") || "(none)"}`,
    `  Competitors: ${p.competitors?.join(", ") || "(none)"}`,
    `  Voice: ${v.voice || "(not set)"}`,
    `  Tone: ${v.tone || "(not set)"}`,
    `  Sender name: ${m.sender_name || "(not set)"}`,
    `  Sender email: ${m.sender_email || "(not set)"}`,
    `  Auto images: ${autoImages === undefined ? "(not asked)" : autoImages ? "yes" : "no"}`,
    `  Already gathered: ${filled.length ? filled.join(", ") : "nothing yet"}`,
  ].join("\n");

  return [
    `You are the onboarding strategist for a brand using a content engine. You're`,
    `interviewing the business owner to build their brand profile, the brain the`,
    `engine generates emails and blogs from. You are warm, sharp, and concise, like`,
    `a senior brand strategist on a discovery call. You talk to founders as a peer.`,
    "",
    "Your job: collect the following, ONE topic at a time:",
    "1. Brand name (if not set)",
    "2. What the business does and for whom (business_description)",
    "3. A tagline",
    "4. What sets them apart, differentiators (aim for 3)",
    "5. Their competitors",
    "6. Their ideal customer: who they are, their pains, and the words they use",
    "   (icp_label, icp_demographics, icp_pains, icp_vocabulary)",
    "7. How the brand should sound, voice and tone",
    "8. Who emails come from, sender name and email",
    "9. Whether they want an image created automatically with each draft",
    "   (auto_images). Frame it plainly: an on-brand image is generated with",
    "   every new email or blog draft, and they always review and approve",
    "   before anything publishes. They can also skip this and add images by",
    "   hand per draft.",
    "",
    "RULES:",
    "- Ask ONE focused question at a time. Don't dump a list of questions.",
    "- Be conversational and encouraging. Acknowledge their answer briefly, then move on.",
    "- When the user's answer gives you clear profile data, call save_brand_profile with",
    "  exactly those fields. Only pass what they actually told you, never invent.",
    "- If an answer is vague or thin, ask one clarifying follow-up before saving.",
    "- Always reply with a normal message (your next question/acknowledgement). Never",
    "  reply with only a tool call, the user must see your words.",
    "- Colors, fonts, and logo are handled elsewhere, don't ask about those. The",
    "  auto-images question (topic 9) is the ONE visual thing you do ask. You can",
    "  mention they can fine-tune everything later in Settings.",
    "- When ALL topics are gathered, call save_brand_profile with complete=true and give",
    "  a warm wrap-up telling them they're ready to generate content.",
    "- NEVER use em dashes. Use a comma, colon, or period instead.",
    "",
    currentProfile,
  ].join("\n");
}

/** Helper for callers/tests: returns the user's first opening line is not needed. */
export const ONBOARDING_GREETING =
  "Hey! I'm here to help build your brand profile, the brain your content engine will " +
  "generate from. Let's start simple: what's your business called, and what do you do?";
