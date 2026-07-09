import "server-only";
import type { EmailTemplateId } from "@/lib/db/types";
import type { EmailTemplate, RenderArgs } from "./types";
import { newsletterTip } from "./newsletter-tip";
import { newsletterFeature } from "./newsletter-feature";
import { newsletterHowto } from "./newsletter-howto";
import { promotionalBold } from "./promotional-bold";
import { announcementBanner } from "./announcement-banner";
import { productSpotlight } from "./product-spotlight";
import { digest } from "./digest";

export { resolveBrandTokens } from "./types";
export type { BrandTokens, EmailTemplate, RenderArgs } from "./types";

export const TEMPLATES: Record<EmailTemplateId, EmailTemplate> = {
  newsletter_tip: newsletterTip,
  newsletter_feature: newsletterFeature,
  newsletter_howto: newsletterHowto,
  promotional_bold: promotionalBold,
  announcement_banner: announcementBanner,
  product_spotlight: productSpotlight,
  digest: digest,
};

/** All templates, in display order, for pickers. */
export const TEMPLATE_LIST: EmailTemplate[] = [
  newsletterTip,
  newsletterFeature,
  newsletterHowto,
  promotionalBold,
  announcementBanner,
  productSpotlight,
  digest,
];

/** Renders structured copy + brand tokens into a complete HTML email. */
export function renderEmailTemplate(
  id: EmailTemplateId,
  args: RenderArgs,
): string {
  const template = TEMPLATES[id] ?? newsletterTip;
  return template.render(args);
}
