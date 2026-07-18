import type { ContentImageStyle } from "@/lib/db/types";

// The single catalog of AI image styles: id + user-facing label + one-line
// description. Client-safe (no server imports) so every style picker (the
// image sheet, the campaign form, Settings → Visual identity) renders from
// this list, and the prompt layer (prompts/generate-image.ts) derives its
// label/description records from it. Adding a style here makes it appear in
// every picker; the matching scaffold + color treatment must be added in
// prompts/generate-image.ts (the build will type-error until both exist).

export interface ImageStyleOption {
  id: ContentImageStyle;
  label: string;
  description: string;
}

export const IMAGE_STYLE_CATALOG: ImageStyleOption[] = [
  {
    id: "illustration",
    label: "Illustration",
    description: "Flat editorial vector art, neutral base with brand-color accents.",
  },
  {
    id: "photo",
    label: "Photo",
    description: "Premium photography, natural light, true-to-life color.",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    description: "Soft hand-painted washes, organic edges, visible paper texture.",
  },
  {
    id: "render3d",
    label: "Soft 3D",
    description: "Soft matte 3D shapes with studio lighting, playful but polished.",
  },
  {
    id: "collage",
    label: "Collage",
    description: "Layered paper-cutout collage, tactile and editorial.",
  },
  {
    id: "retro",
    label: "Retro print",
    description: "Vintage screen-print poster, bold flat shapes, halftone grain.",
  },
  {
    id: "duotone",
    label: "Duotone",
    description: "One striking subject in two bold tones, high contrast, modern.",
  },
  {
    id: "lineart",
    label: "Line art",
    description: "Minimal single-line drawing with one accent fill, gallery-sparse.",
  },
  {
    id: "texture",
    label: "Brand texture",
    description: "Abstract gradient backdrop built only from brand colors.",
  },
];
