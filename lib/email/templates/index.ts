import "server-only";
import type { EmailTemplateId } from "@/lib/db/types";
import { contrast, readableTextColor } from "@/lib/color/contrast";
import type { BrandTokens, EmailTemplate, RenderArgs } from "./types";
import { newsletterTip } from "./newsletter-tip";
import { newsletterFeature } from "./newsletter-feature";
import { newsletterHowto } from "./newsletter-howto";
import { promotionalBold } from "./promotional-bold";
import { announcementBanner } from "./announcement-banner";
import { productSpotlight } from "./product-spotlight";
import { productShowcase } from "./product-showcase";
import { digest } from "./digest";

export { resolveBrandTokens } from "./types";
export type { BrandTokens, EmailTemplate, RenderArgs, ShowcaseProduct } from "./types";

export const TEMPLATES: Record<EmailTemplateId, EmailTemplate> = {
  newsletter_tip: newsletterTip,
  newsletter_feature: newsletterFeature,
  newsletter_howto: newsletterHowto,
  promotional_bold: promotionalBold,
  announcement_banner: announcementBanner,
  product_spotlight: productSpotlight,
  product_showcase: productShowcase,
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
  productShowcase,
  digest,
];

const HEX6 = /^#[0-9a-f]{6}$/i;

function readableOn(color: string, background: string, fallback?: string): string {
  if (!HEX6.test(color) || !HEX6.test(background)) return color;
  if (contrast(color, background) >= 4.5) return color;
  if (fallback && HEX6.test(fallback) && contrast(fallback, background) >= 4.5) return fallback;
  return readableTextColor(background);
}

/**
 * Templates set body copy in `text` and `secondary`, but brands often save
 * `secondary` as a brand color rather than a text tone (a white secondary put
 * white copy on a white card). Done here, not in resolveBrandTokens, because
 * the brand book, flyers, and the design prompt need the brand's real palette.
 */
export function withReadableText(tokens: BrandTokens): BrandTokens {
  const { background } = tokens.colors;
  const text = readableOn(tokens.colors.text, background);
  return {
    ...tokens,
    colors: { ...tokens.colors, text, secondary: readableOn(tokens.colors.secondary, background, text) },
  };
}

/** Renders structured copy + brand tokens into a complete HTML email. */
export function renderEmailTemplate(
  id: EmailTemplateId,
  args: RenderArgs,
): string {
  const template = TEMPLATES[id] ?? newsletterTip;
  return template.render({ ...args, tokens: withReadableText(args.tokens) });
}
