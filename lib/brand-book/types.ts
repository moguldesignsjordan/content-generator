import "server-only";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { BrandGuidelines, Positioning } from "@/lib/db/types";

export type BrandBookTemplateId = "bold_spectrum" | "clean_minimal";

// Everything a brand-book template needs to render. Deliberately narrow: just
// the resolved visual tokens, the approved (or draft) guidelines text, and
// positioning, not the whole Brand/Strategy/Product graph. Nothing here is
// invented by the template, only laid out.
export interface BrandBookArgs {
  brandName: string;
  tokens: BrandTokens;
  guidelines: BrandGuidelines;
  positioning: Positioning;
}

export interface BrandBookTemplate {
  id: BrandBookTemplateId;
  label: string;
  description: string;
  render: (args: BrandBookArgs) => string;
}

// Canvas = this document's own chrome (background/surface/text neutrals),
// independent of the brand's resolved colors. The brand's primary/secondary/
// accent hues are always overlaid as the DOCUMENTED content (swatches,
// gradient, logo wordmark), same relationship as the Mogul reference: neutral
// chrome, brand hues as subject matter. This is what makes "different
// variations" meaningful instead of just re-deriving the brand's own bg color.
export interface CanvasTokens {
  background: string;
  surface: string;
  border: string;
  heading: string;
  body: string;
  muted: string;
}
