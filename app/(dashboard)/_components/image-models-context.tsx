"use client";

import { createContext, useContext } from "react";
import type { ImageModelTier } from "@/lib/db/types";
import {
  DEFAULT_IMAGE_MODEL_TIER,
  imageModelOptions,
  type ImageModelOption,
} from "@/lib/image-models";

// Which image models this deployment can render (GPT ones need an OpenAI
// key, which only the server can see). Provided once by the dashboard layout
// so every picker, however deep, offers the same real choices.
const ImageModelsContext = createContext<ImageModelTier[]>([DEFAULT_IMAGE_MODEL_TIER, "pro"]);

export function ImageModelsProvider({
  tiers,
  children,
}: {
  tiers: ImageModelTier[];
  children: React.ReactNode;
}) {
  return <ImageModelsContext.Provider value={tiers}>{children}</ImageModelsContext.Provider>;
}

/** The image model choices to show in a picker. */
export function useImageModelOptions(): ImageModelOption[] {
  return imageModelOptions(useContext(ImageModelsContext));
}
