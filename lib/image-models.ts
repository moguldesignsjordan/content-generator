import type { ImageModelTier } from "@/lib/db/types";

// Client-safe catalog for the image-model (quality tier) pickers, the same
// pattern as lib/image-styles.ts. The tier → actual Gemini model id mapping
// is server-side (lib/clients/gemini-image.ts, IMAGE_MODELS); pickers only
// ever see tiers, so Google renaming a model never touches stored prefs.

export interface ImageModelOption {
  id: ImageModelTier;
  label: string;
  description: string;
}

export const DEFAULT_IMAGE_MODEL_TIER: ImageModelTier = "standard";

export const IMAGE_MODEL_CATALOG: ImageModelOption[] = [
  {
    id: "lite",
    label: "Lite",
    description: "Fastest and cheapest renders. Good for quick drafts.",
  },
  {
    id: "standard",
    label: "Standard",
    description: "The balanced workhorse. Sharp results for everyday emails.",
  },
  {
    id: "pro",
    label: "Pro",
    description: "Highest quality and detail. Slower, about 3x the cost.",
  },
];

export function isImageModelTier(value: unknown): value is ImageModelTier {
  return (
    typeof value === "string" && IMAGE_MODEL_CATALOG.some((m) => m.id === value)
  );
}
