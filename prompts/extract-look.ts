import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { DesignLookProfile } from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";

// One-time read of a design look (migration 031): the group of ads or posts
// the owner wants flyers to look like. Runs when the look is saved; flyer
// renders attach the example images AND this profile, so no render
// re-analyzes the examples. It describes the DESIGN only (layout, type,
// color roles, how imagery is rendered), never the examples' words, products,
// or brands. What the imagery shows goes in its own field (subjects), so a
// render can take the style without the subject.

export const LookProfileSchema = z.object({
  summary: z.string().min(1),
  layout: z.string().min(1),
  text_placement: z.string().min(1),
  text_amount: z.enum(["minimal", "medium", "heavy"]),
  headline_treatment: z.string().min(1),
  color_roles: z.object({
    background: z.enum(["dark", "light", "vivid", "photo"]),
    accent_usage: z.string(),
  }),
  imagery: z.string().min(1),
  cta_style: z.enum(["pill", "box", "underline", "text", "none"]),
  logo_placement: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "none"]),
  // Lists are trimmed, not rejected: one extra mood word or text spot
  // shouldn't throw the whole read away.
  mood: z.array(z.string()).transform((m) => m.slice(0, 6)),
  text_slots: z.array(z.string()).transform((t) => t.slice(0, 4)).optional(),
  subjects: z.string(),
  has_people: z.boolean(),
});

export const EXTRACT_LOOK_TOOL: Anthropic.Tool = {
  name: "save_look_profile",
  description:
    "Return the shared design profile of the example ads/posts you were shown.",
  // Strict: the arguments always match the schema, so a read can't come back
  // unusable (list lengths aren't enforceable here; parseLookProfile trims).
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 sentences a designer would use to brief someone on this look: what makes these examples feel the way they do. Describe the design, never their words, products, or brands, and never what the imagery depicts: call it 'the main visual', not 'a portrait' or 'a man'.",
      },
      layout: {
        type: "string",
        description:
          "The composition pattern, naming the main visual by its role and position, never by what it depicts, e.g. 'full-bleed photo with text over a dark lower third', 'main visual centered on a flat color field', 'split: large cut-out main visual left breaking the frame edge, text panel right'.",
      },
      text_placement: { type: "string", description: "Where the text sits and how it's aligned." },
      text_amount: {
        type: "string",
        enum: ["minimal", "medium", "heavy"],
        description: "minimal: a headline and maybe a button. heavy: several lines, lists, or prices.",
      },
      headline_treatment: {
        type: "string",
        description:
          "The headline's type only: size relative to the frame, weight, case, and typeface feel, e.g. 'huge condensed uppercase sans, tight leading' or 'small elegant serif, lots of space'. Not prices or other elements.",
      },
      color_roles: {
        type: "object",
        additionalProperties: false,
        properties: {
          background: {
            type: "string",
            enum: ["dark", "light", "vivid", "photo"],
            description: "What dominates behind the text: a dark field, a light field, a saturated color, or a photo.",
          },
          accent_usage: {
            type: "string",
            description: "How the one pop color is used, e.g. 'only on the button', 'highlight one word of the headline'.",
          },
        },
        required: ["background", "accent_usage"],
      },
      imagery: {
        type: "string",
        description:
          "How the imagery is rendered, never what it depicts: the medium and finish (lifestyle photo, studio photo, flat vector, semi-realistic comic illustration, 3D, collage, none), crop, and how it sits in the layout. Never name people, products, or objects here.",
      },
      cta_style: { type: "string", enum: ["pill", "box", "underline", "text", "none"] },
      logo_placement: {
        type: "string",
        enum: ["top-left", "top-right", "bottom-left", "bottom-right", "none"],
      },
      mood: {
        type: "array",
        items: { type: "string" },
        description: "3 to 6 mood words.",
      },
      text_slots: {
        type: "array",
        items: { type: "string" },
        description:
          "Every text element BESIDES the headline, one supporting line, the button, and the logo, by its job and form, e.g. 'date and time in two side-by-side pills', 'location line with a pin icon', 'three short values in a footer bar separated by dots', 'short slogan of three parts under the headline'. Never their actual words. At most 4. Empty when there are none.",
      },
      subjects: {
        type: "string",
        description:
          "What the examples' imagery actually shows, e.g. 'a bearded man, chest up' or 'a yard sign on a lawn'. Kept apart from the style so new designs never copy it.",
      },
      has_people: {
        type: "boolean",
        description: "true when any example shows a person, face, or character, photographed or drawn.",
      },
    },
    required: [
      "subjects",
      "has_people",
      "summary",
      "layout",
      "text_placement",
      "text_amount",
      "headline_treatment",
      "color_roles",
      "imagery",
      "cta_style",
      "logo_placement",
      "mood",
    ],
  },
};

export function buildExtractLookMessages(exampleCount: number): { system: string; user: string } {
  const system = [
    "You are a senior art director. You read example ads and social posts and",
    "write the shared design language a designer could follow to make new,",
    "original pieces in the same style. You describe design only: never copy or",
    "name the examples' text, products, people, or brands. What the imagery",
    "shows goes only in subjects; every other field describes how it looks.",
  ].join("\n");
  const user = [
    `These ${exampleCount} image${exampleCount === 1 ? " is" : "s are"} examples of the look the owner wants their social posts and ads to have.`,
    "Where they differ, describe what they have in common, or the strongest pattern.",
    "Never use em dashes. Call save_look_profile once.",
  ].join("\n");
  return { system, user };
}

/** Validates the tool input; em dashes stripped from every string. */
export function parseLookProfile(input: unknown): DesignLookProfile | null {
  const parsed = LookProfileSchema.safeParse(input);
  if (!parsed.success) return null;
  const clean = (v: string) => stripEmDashes(v).trim();
  const p = parsed.data;
  return {
    ...p,
    summary: clean(p.summary),
    layout: clean(p.layout),
    text_placement: clean(p.text_placement),
    headline_treatment: clean(p.headline_treatment),
    color_roles: { ...p.color_roles, accent_usage: clean(p.color_roles.accent_usage) },
    imagery: clean(p.imagery),
    subjects: clean(p.subjects),
    mood: p.mood.map(clean).filter(Boolean),
    ...(p.text_slots?.length ? { text_slots: p.text_slots.map(clean).filter(Boolean) } : {}),
  };
}
