import type { Anthropic } from "@anthropic-ai/sdk";
import type { OnboardingProposal, VoiceSample } from "@/lib/db/types";
import { mainActionLine } from "@/lib/onboarding/proposal";
import { stripEmDashes } from "@/lib/text";

// Onboarding's voice pick: three short samples about one of the owner's real
// services, each in a different voice, so they choose by ear instead of
// describing their voice in adjectives. A rewrite turns one sample with a
// nudge ("More casual") or the owner's own words.

export const VOICE_SAMPLE_COUNT = 3;
const MIN_WORDS = 30;
const MAX_WORDS = 90;

/** The nudge chips under a picked sample. */
export const VOICE_NUDGES = ["More casual", "More formal", "Shorter", "More fun", "Less salesy"] as const;

export const SAVE_VOICE_SAMPLES_TOOL: Anthropic.Tool = {
  name: "save_voice_samples",
  description: "Save the voice samples. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      samples: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: 'A two or three word name for the voice, e.g. "Friendly neighbor".' },
            voice: {
              type: "string",
              description: "2 to 3 sentences describing how this voice writes: register, rhythm, personality.",
            },
            tone: { type: "string", description: "One sentence on its emotional tone." },
            text: { type: "string", description: "The sample itself, 40 to 70 words." },
            from_site: {
              type: "boolean",
              description: "True only for the sample written to sound like the site's own copy.",
            },
          },
          required: ["name", "voice", "tone", "text", "from_site"],
        },
      },
    },
    required: ["samples"],
  },
};

function profileLines(p: OnboardingProposal): string[] {
  const action = mainActionLine(p.main_action, p.phone, p.website);
  return [
    `Business: ${p.name}`,
    p.description ? `What they do: ${p.description}` : "",
    p.products.length ? `What they sell: ${p.products.map((x) => x.name).join(", ")}` : "",
    p.audience.label ? `Who they sell to: ${p.audience.label}` : "",
    p.service_area ? `Where: ${p.service_area}` : "",
    p.differentiators.length ? `Why people pick them: ${p.differentiators.join("; ")}` : "",
    action ? `Main call to action: ${action}` : "",
  ].filter(Boolean);
}

const RULES = [
  "Rules:",
  "- Use only the facts above. No invented numbers, prices, dates, results,",
  "  awards, years in business, or claims.",
  "- Each sample is 40 to 70 words, a short promo post a customer might read.",
  "- Plain words. No hashtags, no emojis, no em dashes.",
];

/** Builds the (system, user) pair for the three first samples. */
export function buildVoiceSampleMessages(p: OnboardingProposal): { system: string; user: string } {
  const system = [
    "You write short marketing samples so a small business owner can hear",
    "different voices for their business and pick the one that sounds like them.",
  ].join("\n");

  const subject = p.products[0]?.name ?? p.description ?? p.name;
  const fromSite = p.example_lines.length > 0;
  const user = [
    "THE BUSINESS:",
    ...profileLines(p).map((l) => `  ${l}`),
    ...(fromSite
      ? [
          "",
          "LINES FROM THEIR OWN SITE (how they write today):",
          ...p.example_lines.map((l) => `  "${l}"`),
          ...(p.site_voice?.voice ? [`  Described as: ${p.site_voice.voice}`] : []),
        ]
      : []),
    "",
    `Write ${VOICE_SAMPLE_COUNT} samples, all about "${subject}", each in a clearly different voice.`,
    fromSite
      ? "Make the first one sound like their site (from_site true); the other two are real alternatives, e.g. warmer, bolder, or more expert."
      : "Make them real alternatives, e.g. warm and neighborly, bold and direct, calm and expert. All from_site false.",
    "",
    ...RULES,
    "",
    "Call save_voice_samples once.",
  ].join("\n");

  return { system, user };
}

/** Builds the (system, user) pair for rewriting one picked sample. */
export function buildVoiceRewriteMessages(
  p: OnboardingProposal,
  sample: Pick<VoiceSample, "name" | "voice" | "tone" | "text">,
  ask: string,
): { system: string; user: string } {
  const system = "You adjust a short marketing sample until it sounds like the business owner.";
  const user = [
    "THE BUSINESS:",
    ...profileLines(p).map((l) => `  ${l}`),
    "",
    "THE SAMPLE THEY PICKED:",
    `  Voice: ${sample.voice}`,
    `  Tone: ${sample.tone}`,
    `  Text: ${sample.text}`,
    "",
    `WHAT THEY WANT CHANGED: ${ask}`,
    "",
    "Rewrite it once, about the same subject, changed the way they asked. Update",
    "the name, voice, and tone descriptions to match the new version.",
    "",
    ...RULES,
    "",
    "Call save_voice_samples once with exactly one sample (from_site false).",
  ].join("\n");
  return { system, user };
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function cleanField(value: unknown, max: number): string {
  return typeof value === "string" ? stripEmDashes(value).trim().slice(0, max) : "";
}

/**
 * Validates the tool input: every field present, the text within a sane
 * length (a long one is cut at a sentence end), dashes stripped, and at most
 * one sample marked as the site's, only when the site gave lines at all.
 */
export function cleanVoiceSamples(
  input: unknown,
  opts: { max: number; hasSiteLines: boolean },
): VoiceSample[] {
  const raw = (input ?? {}) as { samples?: unknown };
  const out: VoiceSample[] = [];
  let siteTaken = !opts.hasSiteLines;
  for (const entry of Array.isArray(raw.samples) ? raw.samples : []) {
    const s = (entry ?? {}) as Record<string, unknown>;
    let text = cleanField(s.text, 1200);
    if (wordCount(text) > MAX_WORDS) {
      const cut = text.split(/\s+/).slice(0, MAX_WORDS).join(" ");
      const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
      text = end > 0 ? cut.slice(0, end + 1) : cut;
    }
    const sample: VoiceSample = {
      name: cleanField(s.name, 40),
      voice: cleanField(s.voice, 400),
      tone: cleanField(s.tone, 200),
      text,
      from_site: s.from_site === true && !siteTaken,
    };
    if (!sample.name || !sample.voice || wordCount(text) < MIN_WORDS) continue;
    if (sample.from_site) siteTaken = true;
    out.push(sample);
    if (out.length === opts.max) break;
  }
  return out;
}
