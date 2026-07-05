import "server-only";
import type { BrandBookArgs, BrandBookTemplate, BrandBookTemplateId } from "../types";
import { boldSpectrum } from "./bold-spectrum";
import { cleanMinimal } from "./clean-minimal";

export const BRAND_BOOK_TEMPLATES: Record<BrandBookTemplateId, BrandBookTemplate> = {
  bold_spectrum: boldSpectrum,
  clean_minimal: cleanMinimal,
};

export const BRAND_BOOK_TEMPLATE_LIST = Object.values(BRAND_BOOK_TEMPLATES);

export function renderBrandBookTemplate(
  id: BrandBookTemplateId,
  args: BrandBookArgs,
): string {
  const template = BRAND_BOOK_TEMPLATES[id] ?? boldSpectrum;
  return template.render(args);
}
