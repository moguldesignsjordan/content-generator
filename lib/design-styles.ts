import type { EmailStyleId, FlyerStyleId } from "@/lib/db/types";

// Client-safe catalogs for the two DESIGN style pickers (flyers and email
// skins), the same pattern as lib/image-styles.ts for hero-image art styles.
// Every picker renders from these lists; the prompt layer keys off the same
// ids (FLYER_STYLE_DIRECTIONS in prompts/generate-flyer.ts, EMAIL_STYLES in
// prompts/email-styles.ts), and Record completeness + unit tests keep them
// from drifting apart.

export interface DesignStyleOption<Id extends string> {
  id: Id;
  label: string;
  description: string;
}

export const FLYER_STYLE_CATALOG: DesignStyleOption<FlyerStyleId>[] = [
  {
    id: "bold_type",
    label: "Bold type",
    description: "Oversized headline typography, high-contrast color blocks.",
  },
  {
    id: "minimal",
    label: "Sleek minimal",
    description: "Lots of empty space, one focal element, quiet premium feel.",
  },
  {
    id: "photo_backdrop",
    label: "Photo backdrop",
    description: "Full-bleed photograph with clean, legible type over it.",
  },
  {
    id: "illustrated",
    label: "Illustrated",
    description: "Flat vector shapes and scenes, friendly energy.",
  },
  {
    id: "collage",
    label: "Collage",
    description: "Layered cutout elements, tactile and editorial.",
  },
  {
    id: "retro_print",
    label: "Retro print",
    description: "Vintage screen-print poster, bold shapes, halftone grain.",
  },
  {
    id: "gradient_glow",
    label: "Gradient glow",
    description: "Smooth brand-color gradients, modern tech-launch energy.",
  },
  {
    id: "elegant",
    label: "Premium elegant",
    description: "Serif-led refinement, luxurious spacing, understated color.",
  },
];

// Labels must match EMAIL_STYLES in prompts/email-styles.ts (unit-tested);
// descriptions are picker-only copy, written for a non-technical reader.
export const EMAIL_DESIGN_CATALOG: DesignStyleOption<EmailStyleId>[] = [
  {
    id: "soft_card",
    label: "Soft card",
    description: "The approachable baseline: a clean card with a quiet accent bar.",
  },
  {
    id: "editorial_serif",
    label: "Editorial serif",
    description: "A magazine feel: big serif headline, airy, print-like.",
  },
  {
    id: "bold_accent_band",
    label: "Bold accent band",
    description: "A full-color header band, punchy and high-contrast.",
  },
  {
    id: "minimal_mono",
    label: "Minimal mono",
    description: "Borderless and airy; color appears only on the button.",
  },
  {
    id: "bordered_ledger",
    label: "Bordered ledger",
    description: "Structured and enterprise, like a well-organized document.",
  },
  {
    id: "left_rule_editorial",
    label: "Left rule editorial",
    description: "A thick accent rule down the left edge carries the brand.",
  },
  {
    id: "pill_modern",
    label: "Pill modern",
    description: "Rounded and friendly, with a big pill-shaped button.",
  },
  {
    id: "warm_gradient_top",
    label: "Warm gradient top",
    description: "A subtle gradient band up top, warm and friendly.",
  },
];
