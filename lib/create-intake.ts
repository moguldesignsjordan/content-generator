import type { FactoryKind } from "@/lib/db/types";
import { FACTORY_KINDS, FACTORY_KIND_LABELS } from "@/prompts/campaign-formats";

// The Create chat's built-in opening: what's being made, what it's for, any
// photos and what to do with them, plus campaign settings. Answered with
// buttons in the app, then handed to the create agent as one message so it
// starts at the follow-ups instead of re-asking.

export type CreateKind = "email" | "flyer" | "blog" | "campaign";

export const CREATE_KIND_LABELS: Record<CreateKind, string> = {
  email: "Email",
  flyer: "Flyer design",
  blog: "Blog post",
  campaign: "Campaign",
};

const KIND_PHRASES: Record<CreateKind, string> = {
  email: "an email",
  flyer: "a flyer design",
  blog: "a blog post",
  campaign: "a campaign",
};

/** Suggested answers for "what should I do with them?", per kind. */
export const PHOTO_USE_OPTIONS: Record<CreateKind, string[]> = {
  email: ["Put them in the email", "Use one as the main image", "Match this style"],
  flyer: ["Feature the product", "Use it as the background", "Match this style"],
  blog: ["Use one as the main image", "Match this style"],
  campaign: ["Feature the product", "Match this style"],
};

export const CAMPAIGN_SIZES = [6, 12, 20] as const;
export const CAMPAIGN_DAYS = [14, 30] as const;

export interface CampaignSettings {
  kinds: FactoryKind[];
  size: (typeof CAMPAIGN_SIZES)[number];
  days: (typeof CAMPAIGN_DAYS)[number];
  /** Web research before planning. Only ever true when the owner said yes. */
  research: boolean;
}

export interface CreateIntake {
  kind: CreateKind;
  purpose: string;
  photoCount: number;
  photoNote?: string;
  /** A specific look was picked (not just the brand default). */
  lookPicked?: boolean;
  campaign?: CampaignSettings;
}

export function composeIntakeMessage(intake: CreateIntake): string {
  const lines = [
    `I want to create: ${KIND_PHRASES[intake.kind]}.`,
    `What it's for: ${intake.purpose.trim()}`,
  ];
  if (intake.photoCount > 0) {
    const note = intake.photoNote?.trim();
    lines.push(
      `Photos: ${intake.photoCount} attached. What to do with them: ${note || "your call"}.`,
    );
  } else {
    lines.push("Photos: none.");
  }
  if (intake.lookPicked) lines.push("Look: they picked a look to follow in the app.");
  const c = intake.campaign;
  if (intake.kind === "campaign" && c) {
    const kinds = FACTORY_KINDS.filter((k) => c.kinds.includes(k))
      .map((k) => FACTORY_KIND_LABELS[k].toLowerCase())
      .join(", ");
    lines.push(
      `Campaign includes: ${kinds}. ${c.size} pieces over ${c.days === 14 ? "2 weeks" : "30 days"}.`,
      `Research first: ${c.research ? "yes" : "no"}.`,
    );
  }
  return lines.join("\n");
}

/** The opening steps after "what are we creating?", answered in the app. */
export type IntakeStep =
  | "purpose"
  | "photos"
  | "photoNote"
  | "look"
  | "campaignKinds"
  | "campaignSize"
  | "campaignDays"
  | "research";

export const INTAKE_QUESTIONS: Record<IntakeStep, string> = {
  purpose: "What is this for?",
  photos: "Got any references or photos? Product shots, an ad you like, anything helps.",
  photoNote: "What should I do with them? This one's optional.",
  look: "Want it to look like ads you've saved? Pick a look, or keep our layouts.",
  campaignKinds: "What should the campaign include?",
  campaignSize: "How many pieces?",
  campaignDays: "Over how long?",
  research:
    "Want me to research trends and competitors on the web first? It takes a couple of minutes and costs a little more.",
};

/** The step after `from`, or null when the opening is done and the agent takes over. */
export function nextIntakeStep(
  from: IntakeStep,
  draft: { kind: CreateKind; photoCount: number; campaignKinds: FactoryKind[] },
): IntakeStep | null {
  const afterPhotos = (): IntakeStep | null =>
    draft.kind === "flyer" ? "look" : draft.kind === "campaign" ? "campaignKinds" : null;
  switch (from) {
    case "purpose":
      return "photos";
    case "photos":
      return draft.photoCount > 0 ? "photoNote" : afterPhotos();
    case "photoNote":
      return afterPhotos();
    case "campaignKinds":
      return "campaignSize";
    case "campaignSize":
      return "campaignDays";
    case "campaignDays":
      return draft.campaignKinds.some((k) => k === "social" || k === "ad") ? "look" : "research";
    case "look":
      return draft.kind === "campaign" ? "research" : null;
    case "research":
      return null;
  }
}
