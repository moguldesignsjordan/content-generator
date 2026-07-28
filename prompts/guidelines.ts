import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand, DraftEdit, Icp, Product, Strategy } from "@/lib/db/types";

// Brand-guidelines synthesis: Claude distills everything stored about the
// brand into one guidelines document. The route returns it as a PROPOSAL for
// the human to edit; only an explicit Save persists it (with approved_at).

export interface GuidelinesToolInput {
  voice_and_tone?: string;
  messaging_pillars?: string[];
  do_language?: string[];
  dont_language?: string[];
  audience_summary?: string;
  visual_direction?: string;
  cta_philosophy?: string;
}

export const GUIDELINES_TOOL: Anthropic.Tool = {
  name: "save_brand_guidelines",
  description:
    "Return the synthesized brand guidelines. Every field distilled from the " +
    "provided brand data only, never invented facts about the business.",
  input_schema: {
    type: "object",
    properties: {
      voice_and_tone: {
        type: "string",
        description:
          "3-5 sentences: how the brand sounds, its register, and how that shifts by context.",
      },
      messaging_pillars: {
        type: "array",
        items: { type: "string" },
        description: "3-5 core messages every piece of content should reinforce.",
      },
      do_language: {
        type: "array",
        items: { type: "string" },
        description: "Phrases, framings, and vocabulary the brand SHOULD use.",
      },
      dont_language: {
        type: "array",
        items: { type: "string" },
        description: "Phrases, framings, and vocabulary the brand must NEVER use.",
      },
      audience_summary: {
        type: "string",
        description: "2-4 sentences on who the content serves and what they care about.",
      },
      visual_direction: {
        type: "string",
        description: "1-3 sentences on the visual feel (colors, type, layout attitude).",
      },
      cta_philosophy: {
        type: "string",
        description: "1-3 sentences on how the brand asks for action at each funnel stage.",
      },
    },
    required: [
      "voice_and_tone",
      "messaging_pillars",
      "do_language",
      "dont_language",
      "audience_summary",
    ],
  },
};

/** Builds the (system, user) pair for guidelines synthesis. */
export function buildGuidelinesMessages(args: {
  brand: Brand;
  strategy: Strategy | null;
  icps: Icp[];
  products: Product[];
  /** What the user has actually changed on real drafts (migration 026), plus
   * the reasons they gave on thumbs-down ratings. This is the only input here
   * that reflects behavior rather than stated intention, so it's the most
   * honest evidence of the brand's real voice. Empty for a new account. */
  edits?: DraftEdit[];
  dislikeNotes?: string[];
}): { system: string; user: string } {
  const { brand, strategy, icps, products } = args;
  const v = brand.voice_profile ?? {};
  const p = brand.positioning ?? {};
  const vi = brand.visual_identity ?? {};
  const transcript = (brand.onboarding_state?.messages ?? [])
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const system = [
    "You are a senior brand strategist writing the brand guidelines document for",
    `${brand.name}. Distill ONLY the data provided into clear, usable guidance a`,
    "copywriter and designer can follow. Never invent facts, services, or claims",
    "that aren't in the data. Write plainly and specifically; no agency jargon.",
    "",
    "When EDIT HISTORY is present, weight it heavily: those are changes the user",
    "made by hand to real drafts, so they show what this brand actually sounds",
    "like rather than what someone said it should sound like. Look for the",
    "pattern across edits, not the one-off typo fix, and turn a repeated pattern",
    "into a concrete do_language or dont_language line.",
    "NEVER use em dashes anywhere. Use a comma, colon, or period instead.",
    "Call save_brand_guidelines with every required field filled.",
  ].join("\n");

  const user = [
    "BRAND DATA:",
    `Name: ${brand.name}`,
    v.voice ? `Voice: ${v.voice}` : "",
    v.tone ? `Tone: ${v.tone}` : "",
    v.banned_terms?.length ? `Banned terms: ${v.banned_terms.join(", ")}` : "",
    v.example_posts?.length || v.examples?.length
      ? "Voice examples:\n" +
        [...(v.examples?.map((e) => e.content) ?? []), ...(v.example_posts ?? [])]
          .map((e) => `  - ${e}`)
          .join("\n")
      : "",
    v.cta_library
      ? "CTA library:\n" +
        Object.entries(v.cta_library)
          .map(([k, val]) => `  ${k}: ${val}`)
          .join("\n")
      : "",
    p.business_description ? `What the business does: ${p.business_description}` : "",
    p.tagline ? `Tagline: ${p.tagline}` : "",
    p.differentiators?.length
      ? `Differentiators: ${p.differentiators.join("; ")}`
      : "",
    p.competitors?.length ? `Competitors: ${p.competitors.join(", ")}` : "",
    vi.colors
      ? `Brand colors: ${Object.entries(vi.colors)
          .map(([k, val]) => `${k} ${val}`)
          .join(", ")}`
      : "",
    vi.fonts ? `Fonts: heading ${vi.fonts.heading ?? "?"}, body ${vi.fonts.body ?? "?"}` : "",
    strategy?.funnel_definition
      ? "Funnel → CTA: " +
        Object.entries(strategy.funnel_definition)
          .map(([stage, def]) => `${stage}→${def.cta_type}`)
          .join(", ")
      : "",
    ...icps.map((icp) => {
      const pr = icp.profile ?? {};
      return [
        `ICP "${icp.label}"${icp.is_primary ? " (primary)" : ""}:`,
        pr.demographics ? `  Who: ${pr.demographics}` : "",
        pr.pains?.length ? `  Pains: ${pr.pains.join("; ")}` : "",
        pr.vocabulary?.length ? `  Their words: ${pr.vocabulary.join(", ")}` : "",
        pr.objections?.length ? `  Objections: ${pr.objections.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }),
    products.length
      ? "Products:\n" +
        products
          .map(
            (pr) =>
              `  - ${pr.name}${pr.price_point ? ` (${pr.price_point})` : ""}: ${pr.description ?? ""}`,
          )
          .join("\n")
      : "",
    transcript ? `\nONBOARDING CONVERSATION (raw, for voice cues):\n${transcript}` : "",
    buildEditHistoryBlock(args.edits, args.dislikeNotes),
    "",
    "Synthesize the brand guidelines from this data and call save_brand_guidelines.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

/**
 * The user's own corrections, rendered as evidence.
 *
 * Inline edits are shown as before/after pairs because the DIFF is the signal:
 * "cut the adverb", "shortened every sentence", "replaced the exclamation
 * mark" only becomes visible when both sides are present. Style instructions
 * and thumbs-down reasons are already stated in the user's words, so they pass
 * through as written.
 */
export function buildEditHistoryBlock(
  edits: DraftEdit[] | undefined,
  dislikeNotes: string[] | undefined,
): string {
  const inline = (edits ?? []).filter(
    (e) => e.kind === "inline" && e.before_text && e.after_text,
  );
  const style = (edits ?? []).filter((e) => e.kind === "style" && e.instruction);
  const notes = (dislikeNotes ?? []).filter(Boolean);
  if (!inline.length && !style.length && !notes.length) return "";

  const trim = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 240);

  return [
    "",
    "EDIT HISTORY (what the user actually changed on real drafts; the strongest",
    "available evidence of this brand's true voice):",
    ...(inline.length
      ? [
          "Copy they rewrote by hand, before then after:",
          ...inline.map(
            (e) =>
              `  - was: "${trim(e.before_text!)}"\n    became: "${trim(e.after_text!)}"`,
          ),
        ]
      : []),
    ...(style.length
      ? [
          "Design changes they asked for, in their words:",
          ...style.map((e) => `  - ${trim(e.instruction!)}`),
        ]
      : []),
    ...(notes.length
      ? [
          "Reasons they gave for rejecting drafts:",
          ...notes.map((n) => `  - ${trim(n)}`),
        ]
      : []),
  ].join("\n");
}
