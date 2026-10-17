import { MAIN_ACTION_KINDS, type MainActionKind, type OnboardingProposal } from "@/lib/db/types";
import type { QuestionChoice } from "@/lib/create-questions";
import { slugify, stripEmDashes } from "@/lib/text";

// The essentials research couldn't fill become tap questions on the snapshot,
// the same shape as the Create chat's checklist (lib/create-questions.ts):
// code decides what's asked, each question has tap answers, a typed answer,
// and a "Not sure, you pick" fallback.

export const GAP_IDS = ["products", "audience", "main_action"] as const;
export type GapId = (typeof GAP_IDS)[number];

export interface GapQuestion {
  id: GapId;
  question: string;
  choices: QuestionChoice[];
  multi: boolean;
}

export const MAIN_ACTION_LABELS: Record<MainActionKind, string> = {
  call: "Call",
  book: "Book",
  visit: "Visit",
  order: "Order",
  quote: "Get a quote",
  message: "Message",
};

const AUDIENCE_CHOICES = [
  "Homeowners",
  "Local businesses",
  "Families",
  "Professionals",
  "Online shoppers",
];

interface GapSpec {
  question: string;
  multi: boolean;
  choices: (p: OnboardingProposal) => QuestionChoice[];
  filled: (p: OnboardingProposal) => boolean;
  /** Fills the snapshot from tapped or typed values. */
  apply: (p: OnboardingProposal, values: string[]) => OnboardingProposal;
  /** "Not sure, you pick". */
  fallback: (p: OnboardingProposal) => OnboardingProposal;
}

const GAPS: Record<GapId, GapSpec> = {
  products: {
    question: "What do you sell?",
    multi: true,
    choices: () => [],
    filled: (p) => p.products.length > 0,
    apply: (p, values) => ({
      ...p,
      products: values
        .flatMap((v) => v.split(/[,\n]/))
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ slug: slugify(name), name }))
        .filter((x) => x.slug),
    }),
    // Nothing to guess from: generation still works off the description.
    fallback: (p) => p,
  },
  audience: {
    question: "Who do you sell to?",
    multi: false,
    choices: () => AUDIENCE_CHOICES.map((label) => ({ label, value: label })),
    filled: (p) => Boolean(p.audience.label),
    apply: (p, values) => ({
      ...p,
      audience: { ...p.audience, label: values.join(", ") },
      guesses: p.guesses.filter((g) => g !== "audience"),
    }),
    fallback: (p) => ({
      ...p,
      audience: { ...p.audience, label: p.service_area ? `Customers in ${p.service_area}` : "Customers" },
    }),
  },
  main_action: {
    question: "How should customers reach you?",
    multi: false,
    choices: () => MAIN_ACTION_KINDS.map((kind) => ({ label: MAIN_ACTION_LABELS[kind], value: kind })),
    filled: (p) => Boolean(p.main_action.kind),
    apply: (p, values) => {
      const kind = MAIN_ACTION_KINDS.find((k) => k === values[0]);
      if (kind) return { ...p, main_action: { ...p.main_action, kind } };
      // A typed answer is the wording; the kind falls back like "you pick".
      const picked = GAPS.main_action.fallback(p);
      return { ...picked, main_action: { ...picked.main_action, wording: values.join(" ") } };
    },
    fallback: (p) => ({
      ...p,
      main_action: { ...p.main_action, kind: p.phone ? "call" : "visit" },
    }),
  },
};

/** Empty essentials, in priority order (at most three by construction). */
export function gapQuestions(p: OnboardingProposal): GapQuestion[] {
  return GAP_IDS.filter((id) => !GAPS[id].filled(p)).map((id) => ({
    id,
    question: GAPS[id].question,
    choices: GAPS[id].choices(p),
    multi: GAPS[id].multi,
  }));
}

/** Applies a tapped or typed answer. Empty values mean "Not sure, you pick". */
export function answerGap(p: OnboardingProposal, id: GapId, values: string[]): OnboardingProposal {
  const clean = values.map((v) => stripEmDashes(v.trim())).filter(Boolean);
  return clean.length ? GAPS[id].apply(p, clean) : GAPS[id].fallback(p);
}
