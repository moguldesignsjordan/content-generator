import type {
  CampaignBrief,
  FactoryPlanItem,
  FactoryResearch,
  FactoryState,
  Product,
} from "@/lib/db/types";
import { getCampaignFormat } from "@/prompts/campaign-formats";

// Turns one plan-table row into what its draft is generated from: a
// CampaignBrief for emails and blogs (meta.series_brief), or a creative-brief
// string for social posts and ads (meta.flyer_brief). Pure; the launch route
// stores the result on the draft shell.

/** Cap on the research text a single piece carries into its prompt. */
const MAX_RESEARCH_NOTES = 1500;

/**
 * The research a piece is written with: every real fact about the business
 * (stated as true), then the trend that inspired this piece, or the top two
 * when nothing specific did. Empty when there's no research.
 */
export function buildResearchNotes(
  research: FactoryResearch | undefined,
  item: Pick<FactoryPlanItem, "inspired_by">,
): string {
  if (!research) return "";
  const findings = [...research.trends, ...research.competitor_patterns];
  const inspiring = item.inspired_by
    ? findings.filter((f) => f.sources.includes(item.inspired_by!))
    : [];
  const context = (inspiring.length ? inspiring : research.trends.slice(0, 2)).map((f) => f.point);
  const lines = [
    ...(research.brand_facts.length
      ? ["Real facts about this business:", ...research.brand_facts.map((f) => `- ${f.point}`)]
      : []),
    ...(context.length ? ["Working in this niche right now:", ...context.map((p) => `- ${p}`)] : []),
  ];
  return lines.join("\n").slice(0, MAX_RESEARCH_NOTES);
}

/** What a piece knows about its one product: the saved row when there is one. */
export type PieceProduct = Pick<Product, "name"> & Partial<Pick<Product, "description" | "price_point">>;

/** The line that keeps a one-per-product piece on its product. */
export function productFocusLine(product: PieceProduct): string {
  return [
    `Product (this piece is only about this one; the others get their own pieces): ${product.name}`,
    product.description ? `About it: ${product.description}` : "",
    product.price_point ? `Price: ${product.price_point}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

/**
 * The per-piece brief for an email or blog. The row's own hook and core idea
 * become the piece's hook and angle, so each piece keeps the distinct idea it
 * was planned with. A real detail the owner typed is the proof; with none,
 * the writer's no-invention rule stands. Emails always get their picture:
 * the quote already priced it in. The piece's photos travel on its inputs.
 */
export function buildPieceBrief(
  item: FactoryPlanItem,
  factory: Pick<FactoryState, "sentence" | "research">,
  product?: PieceProduct,
): CampaignBrief {
  const format = getCampaignFormat(item.format);
  const research = buildResearchNotes(factory.research, item);
  return {
    // The campaign sentence names every product; this piece sells one.
    goal: product ? `${productFocusLine(product)}. Campaign background: ${factory.sentence}` : factory.sentence,
    ...(product
      ? { constraints: `Only about ${product.name}. Never show or mention the campaign's other products.` }
      : {}),
    conversation_notes: factory.sentence,
    hook: item.hook,
    angle: [item.core_idea, format ? `Format: ${format.label}. ${format.feel}` : ""]
      .filter(Boolean)
      .join(" "),
    key_message: item.key_message,
    // The owner approved this hook and idea in the plan table.
    angle_locked: true,
    ...(research ? { research_notes: research } : {}),
    ...(item.detail?.trim() ? { proof: item.detail.trim() } : {}),
    ...(item.offer_slug ? { offer_slug: item.offer_slug } : {}),
    ...(item.kind === "email" && item.preview ? { subject_line: item.preview } : {}),
    ...(item.kind === "email" ? { include_image: true } : {}),
    // The plan's picture idea becomes the hero's subject.
    ...(item.visual ? { image_subject: item.visual } : {}),
  };
}

/** The creative brief a social post or ad is written from. */
export function buildFlyerBriefText(
  item: FactoryPlanItem,
  sentence: string,
  research?: FactoryResearch,
  product?: PieceProduct,
): string {
  const format = getCampaignFormat(item.format);
  const notes = buildResearchNotes(research, item);
  return [
    ...(product
      ? [productFocusLine(product), `Campaign (background only): ${sentence}`]
      : [`Campaign: ${sentence}`]),
    format ? `Format: ${format.label}. ${format.feel}` : "",
    `Hook (open with this idea): ${item.hook}`,
    item.core_idea ? `Core idea: ${item.core_idea}` : "",
    item.key_message ? `Message: ${item.key_message}` : "",
    item.detail?.trim() ? `Real detail to use (true, from the owner): ${item.detail.trim()}` : "",
    item.visual ? `Picture: ${item.visual}` : "",
    item.cta ? `Call to action: ${item.cta}` : "",
    item.preview ? `Caption opener: ${item.preview}` : "",
    notes ? `Research (facts are true, trends are context):\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
