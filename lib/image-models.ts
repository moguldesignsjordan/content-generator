import type { ImageModelTier } from "@/lib/db/types";

// Client-safe catalog for the image model pickers, the same pattern as
// lib/image-styles.ts. The choice → actual model mapping is server-side
// (lib/clients/image-render.ts); pickers only ever see these ids, so a
// provider renaming a model never touches stored prefs. Pages pass the list
// of choices that can render right now (GPT ones need an OpenAI key).

export interface ImageModelOption {
  id: ImageModelTier;
  label: string;
  description: string;
}

export const DEFAULT_IMAGE_MODEL_TIER: ImageModelTier = "standard";

export const IMAGE_MODEL_CATALOG: ImageModelOption[] = [
  {
    id: "standard",
    label: "Nano Banana 2.1",
    description: "Google's newest. Realistic, quick, great with product photos. About $0.03 an image.",
  },
  {
    id: "pro",
    label: "Nano Banana Pro",
    description: "Google's top model. The finest detail, slower. About $0.13 an image.",
  },
  {
    id: "gpt",
    label: "GPT Image 2.5",
    description: "OpenAI's best. A different look, strong photorealism, slowest. About $0.21 an image.",
  },
  {
    id: "gpt_fast",
    label: "GPT Image 2.5 Fast",
    description: "OpenAI's quicker version at medium quality. About $0.05 an image.",
  },
];

/** Accepts every stored id, including the legacy "lite". */
export function isImageModelTier(value: unknown): value is ImageModelTier {
  return (
    typeof value === "string" &&
    (value === "lite" || IMAGE_MODEL_CATALOG.some((m) => m.id === value))
  );
}

/** The picker options for the choices this deployment can render. */
export function imageModelOptions(available: ImageModelTier[]): ImageModelOption[] {
  return IMAGE_MODEL_CATALOG.filter((m) => available.includes(m.id));
}

/** A stored "lite" shows as the standard choice it now renders as. */
export function displayImageTier(tier: ImageModelTier | undefined | null): ImageModelTier {
  return !tier || tier === "lite" ? DEFAULT_IMAGE_MODEL_TIER : tier;
}
