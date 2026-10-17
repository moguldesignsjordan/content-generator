import type {
  CampaignBrief,
  CampaignDays,
  CampaignSize,
  FactoryKind,
  MakingKind,
  PerProduct,
  ProductSplit,
  VisualVibe,
} from "@/lib/db/types";
import { inputsOf } from "@/lib/inputs";
import { stripEmDashes } from "@/lib/text";

// The Create chat's checklist. The code decides what is still worth asking
// and what was already asked; the model only words the questions. A question
// id lands in brief.asked the moment it's asked, so it can never come back:
// prompt rules alone ("never re-ask") kept losing to other rules.

export const QUESTION_IDS = [
  "making",
  "about",
  "products",
  "split",
  "per_product",
  "channels",
  "size",
  "detail",
  "action",
  "offer",
  "style",
  "photos",
  "where",
  "reach",
  "reader",
  "post_type",
  "proof",
  "example",
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export interface QuestionChoice {
  label: string;
  /** What a tap sends back. For code-owned questions it's validated and saved
   * straight into the brief; otherwise it's just the label. */
  value: string;
}

/** A question as the chat's question card shows it. */
export interface ChatQuestion {
  id: QuestionId;
  question: string;
  choices: QuestionChoice[];
  multi: boolean;
}

/** One answered question from the card. */
export interface QuestionAnswer {
  id: string;
  values: string[];
}

interface QuestionSpec {
  /** Plain-words version the turn state shows the model. */
  ask: string;
  /** Structural: always asked. The rest share MAX_OPTIONAL turns, then
   * take their defaults. */
  must?: boolean;
  applies: (brief: CampaignBrief) => boolean;
  filled: (brief: CampaignBrief) => boolean;
  /** Named in the confirm when it was skipped. */
  fallback: (brief: CampaignBrief) => string;
}

const IMAGE_CHANNELS: FactoryKind[] = ["social", "ad"];

function productCount(brief: CampaignBrief): number {
  return brief.products?.length ?? 0;
}

/** Several pieces of one kind, one per product, which go to the planner. */
export function isProductSet(brief: CampaignBrief): boolean {
  return productCount(brief) >= 2 && brief.split === "each";
}

/** Anything that becomes more than one piece goes through start_campaign. */
export function makesCampaign(brief: CampaignBrief): boolean {
  return brief.making === "campaign" || (brief.making !== undefined && isProductSet(brief));
}

function hasImages(brief: CampaignBrief): boolean {
  if (brief.making === "flyer" || brief.making === "ad") return true;
  if (brief.making !== "campaign") return false;
  return !brief.channels?.length || brief.channels.some((c) => IMAGE_CHANNELS.includes(c));
}

const is = (...kinds: MakingKind[]) => (brief: CampaignBrief) =>
  brief.making !== undefined && kinds.includes(brief.making);

const QUESTIONS: Record<QuestionId, QuestionSpec> = {
  making: {
    ask: "What are we making?",
    must: true,
    applies: (b) => b.making === undefined,
    filled: (b) => b.making !== undefined,
    fallback: () => "an email",
  },
  about: {
    ask: "What's it about, in their words?",
    must: true,
    applies: () => true,
    filled: (b) => Boolean(b.key_message || b.angle || b.hook || productCount(b)),
    fallback: () => "the brand's strongest offer",
  },
  products: {
    ask: "Which products is it for?",
    applies: (b) => b.making === "campaign",
    filled: (b) => Boolean(productCount(b) || b.offer_slug),
    fallback: () => "the brand as a whole, no single product",
  },
  split: {
    ask: "A separate design for each product, or one with all of them?",
    must: true,
    applies: (b) => is("flyer", "ad", "campaign")(b) && productCount(b) >= 2,
    filled: (b) => b.split !== undefined,
    fallback: () => "a separate design for each product",
  },
  per_product: {
    ask: "How many for each product?",
    must: true,
    applies: (b) => is("flyer", "ad", "campaign")(b) && isProductSet(b),
    filled: (b) => b.per_product !== undefined,
    fallback: (b) => (b.making === "campaign" ? "3 each" : "1 each"),
  },
  channels: {
    ask: "What should it include (posts, ads, emails, blog)?",
    applies: is("campaign"),
    filled: (b) => Boolean(b.channels?.length),
    fallback: () => "posts, ads, emails, and a blog post",
  },
  size: {
    ask: "How big (6, 12, or 20 pieces)?",
    applies: (b) => b.making === "campaign" && !isProductSet(b),
    filled: (b) => b.size !== undefined,
    fallback: () => "12 pieces over 30 days",
  },
  detail: {
    ask: "The real detail only they know: a number, a deal, a deadline, a client win?",
    applies: is("email"),
    filled: (b) => Boolean(b.proof || b.offer_deal || b.offer_deadline || b.offer_price || b.hook),
    fallback: () => "no specific number or deal",
  },
  action: {
    ask: "What should people do after reading?",
    applies: is("email"),
    filled: (b) => Boolean(b.goal),
    fallback: () => "the brand's usual next step",
  },
  offer: {
    ask: "Any deal, price, or deadline to show?",
    applies: is("flyer", "ad", "campaign"),
    filled: (b) => Boolean(b.offer_deal || b.offer_price || b.offer_deadline),
    fallback: () => "no special offer",
  },
  style: {
    ask: "Got a flyer or post they like the look of (a screenshot via the paperclip), or which vibe?",
    applies: hasImages,
    filled: (b) => {
      const inputs = inputsOf(b);
      return Boolean(inputs.style || inputs.style_images?.urls.length);
    },
    fallback: () => "Our style (a fresh style when Our style has no examples yet)",
  },
  photos: {
    ask: "Any photos of the product or work to put in it?",
    applies: hasImages,
    filled: (b) => Boolean(inputsOf(b).photos?.length),
    fallback: () => "pictures made from the brand colors, no photos",
  },
  where: {
    ask: "Where will it be posted?",
    applies: (b) => b.making === "flyer" && !isProductSet(b),
    filled: () => false,
    fallback: () => "a square post",
  },
  reach: {
    ask: "Who should the ad reach?",
    applies: is("ad"),
    filled: (b) => Boolean(b.audience_notes),
    fallback: () => "the brand's main audience",
  },
  reader: {
    ask: "Who's reading it, and what question does it answer for them?",
    applies: is("blog"),
    filled: (b) => Boolean(b.audience_notes),
    fallback: () => "the brand's main audience",
  },
  post_type: {
    ask: "What kind of post (how-to, list, case study, opinion)?",
    applies: is("blog"),
    filled: () => false,
    fallback: () => "a format picked to fit the topic",
  },
  proof: {
    ask: "A real result or customer story to point at?",
    applies: is("blog", "campaign"),
    filled: (b) => Boolean(b.proof),
    fallback: () => "no real result, so none is made up",
  },
  example: {
    ask: "An email they love the feel of, to paste or attach?",
    applies: is("email"),
    filled: (b) => Boolean(b.style_example),
    fallback: () => "written in the brand's own voice",
  },
};

/** Priority order per kind: the first open ones are asked. */
const ORDER: Record<MakingKind | "unknown", QuestionId[]> = {
  unknown: ["making", "about"],
  email: ["about", "detail", "action", "example"],
  flyer: ["about", "split", "per_product", "style", "photos", "offer", "where"],
  ad: ["about", "split", "per_product", "style", "photos", "offer", "reach"],
  blog: ["about", "reader", "proof", "post_type"],
  campaign: [
    "about",
    "channels",
    "products",
    "split",
    "per_product",
    "size",
    "style",
    "photos",
    "offer",
    "proof",
  ],
};

/** One question per message, like a person texting. */
export const MAX_QUESTIONS = 1;

/** Non-structural questions asked over the whole chat; the rest default. */
export const MAX_OPTIONAL = 4;

function relevant(brief: CampaignBrief): QuestionId[] {
  return ORDER[brief.making ?? "unknown"].filter((id) => QUESTIONS[id].applies(brief));
}

/** What's still worth asking, in order: applicable, not filled, never asked,
 * and within the optional budget. Only the first is asked each message. */
export function openQuestions(brief: CampaignBrief): QuestionId[] {
  const asked = new Set(brief.asked ?? []);
  let budget = MAX_OPTIONAL - QUESTION_IDS.filter((id) => asked.has(id) && !QUESTIONS[id].must).length;
  return relevant(brief).filter((id) => {
    if (asked.has(id) || QUESTIONS[id].filled(brief)) return false;
    if (QUESTIONS[id].must) return true;
    return budget-- > 0;
  });
}

/** Once a round has been asked: every question that won't be asked again
 * and is still unanswered, with the default the confirm names. */
export function skippedDefaults(brief: CampaignBrief): { id: QuestionId; fallback: string }[] {
  if (!brief.asked?.length) return [];
  const open = new Set(openQuestions(brief));
  return relevant(brief)
    .filter((id) => !open.has(id) && !QUESTIONS[id].filled(brief))
    .map((id) => ({ id, fallback: QUESTIONS[id].fallback(brief) }));
}

/** The plain-words question for an id, for the turn state. */
export function questionText(id: QuestionId): string {
  return QUESTIONS[id].ask;
}

const EACH_WORDS =
  /\b(product campaign|print campaign|for each|each (one|product)|separate\w*|per product|one per)\b|\bshowcas\w*[^.?!]{0,40}\blineup\b/i;
// Not a bare "together": "put together a campaign" is how people ask for one.
const TOGETHER_WORDS =
  /\b(bundled?|bundles|as a package|package deal|all[ -]in[ -]one|(all|them|everything) together|in one (flyer|post|ad|design|piece))\b/i;

/** "Each" or "together" when their words settle it, else null (ask). */
export function splitFromWords(text: string): ProductSplit | null {
  const each = EACH_WORDS.test(text);
  const together = TOGETHER_WORDS.test(text);
  if (each === together) return null;
  return each ? "each" : "together";
}

/** The brief with split settled from their words, when 2+ products are in
 * play and it isn't set yet. */
export function inferSplit(brief: CampaignBrief, userText: string): CampaignBrief {
  if (brief.split || productCount(brief) < 2) return brief;
  const split = splitFromWords(userText);
  return split ? { ...brief, split } : brief;
}

const CHANNEL_CHOICES: { label: string; value: FactoryKind }[] = [
  { label: "Posts", value: "social" },
  { label: "Ads", value: "ad" },
  { label: "Emails", value: "email" },
  { label: "Blog", value: "blog" },
];

const SIZE_CHOICES: { label: string; size: CampaignSize; days: CampaignDays }[] = [
  { label: "6 over 2 weeks", size: 6, days: 14 },
  { label: "12 over 30 days", size: 12, days: 30 },
  { label: "20 over 30 days", size: 20, days: 30 },
];

const SPLIT_CHOICES: { label: string; value: ProductSplit }[] = [
  { label: "A separate design for each", value: "each" },
  { label: "One with all of them", value: "together" },
];

const PER_PRODUCT_CHOICES: { label: string; value: PerProduct }[] = [
  { label: "1 each (a one-off)", value: 1 },
  { label: "3 each", value: 3 },
  { label: "6 each", value: 6 },
];

const MAKING_CHOICES: { label: string; value: MakingKind }[] = [
  { label: "Email", value: "email" },
  { label: "Flyer", value: "flyer" },
  { label: "Ad", value: "ad" },
  { label: "Blog post", value: "blog" },
  { label: "Campaign", value: "campaign" },
];

const WHERE_CHOICES = ["Instagram or Facebook post", "Story or Reel", "Feed portrait"];

const VIBE_CHOICES: { label: string; value: VisualVibe }[] = [
  { label: "Bold and loud", value: "punchy" },
  { label: "Clean and simple", value: "sleek" },
  { label: "Fun and playful", value: "playful" },
  { label: "High-end", value: "premium" },
];
const POST_TYPE_CHOICES = ["How-to", "List", "Case study", "Opinion piece"];

const asChoices = (labels: string[]): QuestionChoice[] =>
  labels.map((label) => ({ label, value: label }));

/** The fixed choices code owns for a question, or null when the model words
 * them. `savedProducts` are the brand's product names. */
export function fixedChoices(
  id: QuestionId,
  brief: CampaignBrief,
  savedProducts: string[],
): { choices: QuestionChoice[]; multi: boolean } | null {
  switch (id) {
    case "making":
      return { choices: MAKING_CHOICES.map((c) => ({ label: c.label, value: c.value })), multi: false };
    case "channels":
      return { choices: CHANNEL_CHOICES.map((c) => ({ ...c })), multi: true };
    case "size":
      return { choices: SIZE_CHOICES.map((c) => ({ label: c.label, value: String(c.size) })), multi: false };
    case "split":
      return { choices: SPLIT_CHOICES.map((c) => ({ ...c })), multi: false };
    case "per_product":
      return {
        choices: PER_PRODUCT_CHOICES.map((c) => ({ label: c.label, value: String(c.value) })),
        multi: false,
      };
    case "products": {
      const names = uniqueNames([...(brief.products ?? []), ...savedProducts]).slice(0, 12);
      return { choices: asChoices(names), multi: true };
    }
    case "where":
      return { choices: asChoices(WHERE_CHOICES), multi: false };
    case "post_type":
      return { choices: asChoices(POST_TYPE_CHOICES), multi: false };
    case "style":
      // The chips add a saved-looks chip that opens the look picker.
      return { choices: VIBE_CHOICES.map((c) => ({ ...c })), multi: false };
    case "photos":
      return { choices: [{ label: "No photos, make the pictures", value: "none" }], multi: false };
    default:
      return null;
  }
}

const MAX_PRODUCTS = 12;
const MAX_PRODUCT_NAME = 80;

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_PRODUCT_NAME);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Product names as stored: trimmed, deduped, capped. */
export function cleanProductNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return uniqueNames(names.filter((n): n is string => typeof n === "string")).slice(0, MAX_PRODUCTS);
}

/** The brief with the card's code-owned answers saved, each validated against
 * its fixed choices. Anything else rides in the message for the model. */
export function applyAnswers(brief: CampaignBrief, answers: unknown): CampaignBrief {
  if (!Array.isArray(answers)) return brief;
  const next = { ...brief };
  for (const raw of answers) {
    if (!raw || typeof raw !== "object") continue;
    const { id, values } = raw as { id?: unknown; values?: unknown };
    if (typeof id !== "string" || !Array.isArray(values)) continue;
    const picked = values.filter((v): v is string => typeof v === "string");
    if (!picked.length) continue;
    switch (id) {
      case "making": {
        const kind = MAKING_CHOICES.find((c) => c.value === picked[0])?.value;
        if (kind) next.making = kind;
        break;
      }
      case "channels": {
        const kinds = CHANNEL_CHOICES.filter((c) => picked.includes(c.value)).map((c) => c.value);
        if (kinds.length) next.channels = kinds;
        break;
      }
      case "size": {
        const choice = SIZE_CHOICES.find((c) => String(c.size) === picked[0]);
        if (choice) {
          next.size = choice.size;
          next.days = choice.days;
        }
        break;
      }
      case "split": {
        const split = SPLIT_CHOICES.find((c) => c.value === picked[0])?.value;
        if (split) next.split = split;
        break;
      }
      case "per_product": {
        const count = PER_PRODUCT_CHOICES.find((c) => String(c.value) === picked[0])?.value;
        if (count) next.per_product = count;
        break;
      }
      case "products": {
        const names = cleanProductNames(picked);
        if (names.length) next.products = names;
        break;
      }
      case "style": {
        const vibe = VIBE_CHOICES.find((c) => c.value === picked[0])?.value;
        if (vibe) next.visual_vibe = vibe;
        break;
      }
    }
  }
  return next;
}

/** Records question ids as asked (deduped, known ids only). */
export function markAsked(brief: CampaignBrief, ids: string[]): CampaignBrief {
  const known = ids.filter((id): id is QuestionId => (QUESTION_IDS as readonly string[]).includes(id));
  if (!known.length) return brief;
  return { ...brief, asked: Array.from(new Set([...(brief.asked ?? []), ...known])) };
}

const MAX_QUESTION_CHARS = 200;
const MAX_CHOICE_CHARS = 60;
const MAX_MODEL_CHOICES = 4;

/**
 * The ask tool's question as the chips show it: only an id still open
 * survives (a question can't come back), code-owned choices replace the
 * model's, and it plus every open id before it counts as asked from here on
 * (one skipped was judged already answered).
 */
export function cleanAsk(
  input: unknown,
  brief: CampaignBrief,
  savedProducts: string[],
): { questions: ChatQuestion[]; dropped: string[]; brief: CampaignBrief } {
  const open = openQuestions(brief);
  const raw = (input as { questions?: unknown } | null)?.questions;
  const questions: ChatQuestion[] = [];
  const dropped: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    const q = item as { id?: unknown; question?: unknown; choices?: unknown; multi?: unknown };
    const id = typeof q.id === "string" ? q.id : "";
    const text = typeof q.question === "string" ? stripEmDashes(q.question.trim()).slice(0, MAX_QUESTION_CHARS) : "";
    if (!text) continue;
    if (!open.includes(id as QuestionId) || questions.some((x) => x.id === id)) {
      dropped.push(id || text);
      continue;
    }
    const fixed = fixedChoices(id as QuestionId, brief, savedProducts);
    const modelChoices = Array.isArray(q.choices)
      ? asChoices(
          q.choices
            .filter((c): c is string => typeof c === "string")
            .map((c) => stripEmDashes(c.trim()).slice(0, MAX_CHOICE_CHARS))
            .filter(Boolean)
            .slice(0, MAX_MODEL_CHOICES),
        )
      : [];
    questions.push({
      id: id as QuestionId,
      question: text,
      choices: fixed?.choices ?? modelChoices,
      multi: fixed ? fixed.multi : q.multi === true,
    });
    if (questions.length === MAX_QUESTIONS) break;
  }
  const last = questions.length ? open.indexOf(questions[questions.length - 1].id) : -1;
  return { questions, dropped, brief: last >= 0 ? markAsked(brief, open.slice(0, last + 1)) : brief };
}

/** Lines for the turn state: what's open, what was asked and its default. */
export function checklistLines(brief: CampaignBrief): string[] {
  const open = openQuestions(brief);
  const skipped = skippedDefaults(brief);
  return [
    open.length
      ? `STILL OPEN (in order; ask ONE per message with the ask tool, the first their words don't already answer): ${open
          .map((id) => `${id} (${QUESTIONS[id].ask})`)
          .join("; ")}`
      : "STILL OPEN: nothing. Don't ask more questions: confirm in one sentence, naming the defaults below.",
    ...(skipped.length
      ? [
          `ASKED ALREADY OR SKIPPED (never ask again; use these defaults unless they said otherwise): ${skipped
            .map((s) => `${s.id}: ${s.fallback}`)
            .join("; ")}`,
        ]
      : []),
  ];
}
