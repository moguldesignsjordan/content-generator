import "server-only";
import type { EmailTemplateId } from "@/lib/db/types";
import type { EmailTemplate, RenderArgs } from "./types";
import { newsletterTip } from "./newsletter-tip";
import { newsletterFeature } from "./newsletter-feature";
import { newsletterHowto } from "./newsletter-howto";

export { resolveBrandTokens } from "./types";
export type { BrandTokens, EmailTemplate, RenderArgs } from "./types";

export const TEMPLATES: Record<EmailTemplateId, EmailTemplate> = {
  newsletter_tip: newsletterTip,
  newsletter_feature: newsletterFeature,
  newsletter_howto: newsletterHowto,
};

/** All templates, in display order, for pickers. */
export const TEMPLATE_LIST: EmailTemplate[] = [
  newsletterTip,
  newsletterFeature,
  newsletterHowto,
];

/** Renders structured copy + brand tokens into a complete HTML email. */
export function renderEmailTemplate(
  id: EmailTemplateId,
  args: RenderArgs,
): string {
  const template = TEMPLATES[id] ?? newsletterTip;
  return template.render(args);
}
