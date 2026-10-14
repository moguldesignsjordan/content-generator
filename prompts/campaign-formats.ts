import type { BlogType, EmailType, FactoryKind } from "@/lib/db/types";

// The campaign factory's format library, modeled on the content-factory
// skill's format table: every piece in a plan is one named format with a
// clear feel and a few concept seeds, so a 12-piece campaign is 12 different
// ideas instead of one idea written 12 times. Pure and client-safe: the plan
// prompt and the plan table both read it.

export type CampaignFormatId =
  | "offer_drop"
  | "transformation"
  | "proof"
  | "quick_tip"
  | "behind_scenes"
  | "ad_problem_solution"
  | "ad_social_proof"
  | "ad_offer_urgency"
  | "ad_direct_benefit"
  | "email_promotional"
  | "email_product"
  | "email_newsletter"
  | "email_announcement"
  | "blog_how_to"
  | "blog_listicle"
  | "blog_case_study"
  | "blog_thought_leadership";

export interface CampaignFormat {
  id: CampaignFormatId;
  kind: FactoryKind;
  label: string;
  feel: string;
  seeds: string[];
  emailType?: EmailType;
  blogType?: BlogType;
}

export const FACTORY_KINDS: FactoryKind[] = ["social", "ad", "email", "blog"];

export const FACTORY_KIND_LABELS: Record<FactoryKind, string> = {
  social: "Social posts",
  ad: "Paid ads",
  email: "Emails",
  blog: "Blog posts",
};

export const CAMPAIGN_FORMATS: CampaignFormat[] = [
  {
    id: "offer_drop",
    kind: "social",
    label: "Offer drop",
    feel: "The deal itself, stated plainly, with a reason to act now.",
    seeds: [
      "The offer in one line, with the deadline",
      "What you get, itemized",
      "Price set against the cost of doing it yourself",
      "Last-chance reminder",
    ],
  },
  {
    id: "transformation",
    kind: "social",
    label: "Transformation",
    feel: "Before and after: the change the customer gets.",
    seeds: [
      "The old way vs the new way",
      "One customer's before and after",
      "The moment it clicked",
      "What changes in week one",
    ],
  },
  {
    id: "proof",
    kind: "social",
    label: "Proof",
    feel: "A real result or a real customer's words.",
    seeds: [
      "One number that matters",
      "A short customer quote",
      "The project that went better than planned",
      "Why a customer came back",
    ],
  },
  {
    id: "quick_tip",
    kind: "social",
    label: "Quick tip",
    feel: "One useful thing the reader can do today, no pitch needed.",
    seeds: [
      "The mistake almost everyone makes",
      "A 30-second check",
      "One rule of thumb",
      "The question to ask before buying",
    ],
  },
  {
    id: "behind_scenes",
    kind: "social",
    label: "Behind the scenes",
    feel: "How the work actually gets made, by real people.",
    seeds: [
      "The tools on the desk",
      "A step most people never see",
      "What a normal day looks like",
      "The detail we obsess over",
    ],
  },
  {
    id: "ad_problem_solution",
    kind: "ad",
    label: "Problem to solution",
    feel: "Name the pain in the reader's words, then the fix.",
    seeds: [
      "The frustrating moment, then the way out",
      "The question they keep asking themselves",
      "What it costs to keep putting it off",
    ],
  },
  {
    id: "ad_social_proof",
    kind: "ad",
    label: "Social proof",
    feel: "Others like the reader already did it and it worked.",
    seeds: [
      "Customer result up front",
      "How many people already chose it",
      "A review in the customer's own words",
    ],
  },
  {
    id: "ad_offer_urgency",
    kind: "ad",
    label: "Offer + urgency",
    feel: "A clear offer with an honest reason to act this week.",
    seeds: [
      "Limited spots or dates",
      "Seasonal deadline",
      "Bonus for the first buyers",
    ],
  },
  {
    id: "ad_direct_benefit",
    kind: "ad",
    label: "Direct benefit",
    feel: "One concrete outcome, said as simply as possible.",
    seeds: [
      "The single biggest benefit",
      "What they get in a set time",
      "The result without the hassle",
    ],
  },
  {
    id: "email_promotional",
    kind: "email",
    label: "Promotion",
    feel: "Sell the offer with one strong reason and one call to action.",
    seeds: ["The offer and its deadline", "Why now", "What's included"],
    emailType: "promotional",
  },
  {
    id: "email_product",
    kind: "email",
    label: "Product spotlight",
    feel: "One product or service, shown in use, with the outcome.",
    seeds: ["How a customer uses it", "The feature people miss", "Who it's for"],
    emailType: "product",
  },
  {
    id: "email_newsletter",
    kind: "email",
    label: "Value newsletter",
    feel: "Teach something useful; the offer is a light close.",
    seeds: ["A short how-to", "Lessons from a recent project", "A myth, corrected"],
    emailType: "newsletter",
  },
  {
    id: "email_announcement",
    kind: "email",
    label: "Announcement",
    feel: "Something new: what it is, why it matters, what to do.",
    seeds: ["The launch", "A new option or service", "News the reader should hear first"],
    emailType: "announcement",
  },
  {
    id: "blog_how_to",
    kind: "blog",
    label: "How-to guide",
    feel: "Step by step, so the reader can actually do it.",
    seeds: ["A complete walkthrough", "A checklist with reasons", "Fixing a common problem"],
    blogType: "how_to",
  },
  {
    id: "blog_listicle",
    kind: "blog",
    label: "List post",
    feel: "A numbered set of ideas, each one specific.",
    seeds: ["Ideas to steal", "Mistakes to avoid", "Questions to ask"],
    blogType: "listicle",
  },
  {
    id: "blog_case_study",
    kind: "blog",
    label: "Case study",
    feel: "One real project from problem to result.",
    seeds: ["The brief, the work, the outcome", "What we'd do differently", "The turning point"],
    blogType: "case_study",
  },
  {
    id: "blog_thought_leadership",
    kind: "blog",
    label: "Point of view",
    feel: "A clear opinion about the industry, argued well.",
    seeds: ["What most advice gets wrong", "Where the industry is heading", "An unpopular rule we follow"],
    blogType: "thought_leadership",
  },
];

const FORMAT_BY_ID = new Map(CAMPAIGN_FORMATS.map((f) => [f.id as string, f]));

export function getCampaignFormat(id: string): CampaignFormat | undefined {
  return FORMAT_BY_ID.get(id);
}

export function formatsForKind(kind: FactoryKind): CampaignFormat[] {
  return CAMPAIGN_FORMATS.filter((f) => f.kind === kind);
}

/**
 * Splits `count` pieces evenly across the chosen kinds, the skill's rule:
 * floor(count / kinds) each, then the remainder one at a time from the first
 * kind. 7 across [social, ad, email] gives 3 / 2 / 2.
 */
export function splitEvenly(
  count: number,
  kinds: FactoryKind[],
): Record<FactoryKind, number> {
  const out: Record<FactoryKind, number> = { social: 0, ad: 0, email: 0, blog: 0 };
  if (!kinds.length || count <= 0) return out;
  const per = Math.floor(count / kinds.length);
  let remainder = count - per * kinds.length;
  for (const kind of kinds) {
    out[kind] = per + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return out;
}
