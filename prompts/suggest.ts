import type { Brand, Icp } from "@/lib/db/types";
import { buildBrandVoiceBlock } from "./brand-voice";

// The profile fields an AI suggestion can be requested for. These are the
// human-authored fields where a draft is welcome but the human owns the final.
export type SuggestField =
  | "business_description"
  | "tagline"
  | "differentiators"
  | "competitors";

const FIELD_BRIEFS: Record<SuggestField, string> = {
  business_description:
    "a 2 to 3 sentence description of what the business does and for whom",
  tagline: "a single short tagline (under 12 words)",
  differentiators:
    "3 to 4 sharp points on what sets this business apart (one per line)",
  competitors:
    "3 to 5 likely competitors by name (one per line). If unknown, infer plausible ones from the category.",
};

/**
 * Builds the (system, user) message pair for an AI suggestion on one profile
 * field. The model returns ONE plain-text draft; the human applies/edits it in
 * the UI. Nothing here is persisted by the suggest path, Save is the only
 * write path.
 */
export function buildSuggestMessages(
  brand: Brand,
  icp: Icp | null,
  field: SuggestField,
  currentValue?: string | string[],
): { system: string; user: string } {
  const voiceBlock = buildBrandVoiceBlock(brand, icp);

  const system = [
    `You are a brand strategist helping the team at ${brand.name} fill out their`,
    "brand profile. You draft concise, specific, evidence-grounded copy in the",
    "brand's own voice. You never use em dashes. You return ONLY the requested",
    "content, no preamble, no labels, no markdown.",
    "",
    voiceBlock,
  ].join("\n");

  const list = currentValue
    ? Array.isArray(currentValue)
      ? currentValue
      : [currentValue]
    : [];
  const current = list.filter(Boolean).join("\n");

  const user = [
    `Draft ${FIELD_BRIEFS[field]} for ${brand.name}.`,
    current ? `EXISTING VALUE (improve or replace it):\n${current}` : "",
    "Return only the final content as plain text.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
