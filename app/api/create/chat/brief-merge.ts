import {
  CAMPAIGN_BRIEF_TEXT_FIELDS,
  MAX_CONVERSATION_NOTES_CHARS,
  type CampaignBrief,
  type CampaignKind,
  type VisualVibe,
} from "@/lib/db/types";
import type { UpdateBriefInput } from "@/prompts/create-agent";
import { emailHtmlToText, stripEmDashes } from "@/lib/text";
import { IMAGE_STYLE_CATALOG } from "@/lib/image-styles";
import { EMAIL_DESIGN_CATALOG } from "@/lib/design-styles";
import { inputsOf, withInputs } from "@/lib/inputs";
import { cleanClientBrand, cleanReferenceUrls } from "@/lib/looks";

// Pulled out of route.ts (which Next.js only allows GET/POST/config exports
// from) so mergeBrief's field-by-field merge rules can be unit tested
// directly instead of only through the route's HTTP surface.

const VISUAL_VIBES: VisualVibe[] = ["punchy", "sleek", "playful", "premium"];

const CAMPAIGN_KINDS: CampaignKind[] = ["product", "promotion", "newsletter", "launch"];

/** True for a well-formed http(s) URL; guards against the model inventing one. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Merges only the fields the model actually passed onto the stored brief. */
export function mergeBrief(current: CampaignBrief, input: UpdateBriefInput): CampaignBrief {
  const next = { ...current };
  for (const key of CAMPAIGN_BRIEF_TEXT_FIELDS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      next[key] = stripEmDashes(value.trim());
    }
  }
  // Kept verbatim (no em-dash stripping): it's the user's own reference
  // email, not copy this engine produced. Flattened and capped so a pasted
  // HTML export or thread can't balloon the stored brief.
  if (typeof input.style_example === "string" && input.style_example.trim()) {
    next.style_example = emailHtmlToText(input.style_example).slice(0, 8000);
  }
  if (input.length === "short" || input.length === "standard" || input.length === "long") {
    next.length = input.length;
  }
  if (typeof input.include_image === "boolean") {
    next.include_image = input.include_image;
  }
  if (input.visual_vibe && VISUAL_VIBES.includes(input.visual_vibe)) {
    next.visual_vibe = input.visual_vibe;
  }
  if (
    input.image_style &&
    IMAGE_STYLE_CATALOG.some((s) => s.id === input.image_style)
  ) {
    next.image_style = input.image_style;
  }
  if (
    input.email_style &&
    EMAIL_DESIGN_CATALOG.some((s) => s.id === input.email_style)
  ) {
    next.email_style = input.email_style;
  }
  // Photos, style images, and competitor ads live in inputs (lib/inputs.ts).
  // The lists have replace semantics (the model resends the whole list); a
  // URL still has to pass isHttpUrl, the real guard against an invented or
  // malformed value (the route then keeps only our own uploads).
  let inputs = inputsOf(next);
  if (Array.isArray(input.photos)) {
    inputs = {
      ...inputs,
      photos: input.photos
        .filter((u): u is string => typeof u === "string")
        .map((u) => u.trim())
        .filter(isHttpUrl),
    };
  }
  if (input.use_ai_image_instead === true) {
    inputs = { ...inputs, photos: [] };
  }
  if (Array.isArray(input.style_images)) {
    const urls = cleanReferenceUrls(input.style_images, isHttpUrl);
    inputs = urls.length
      ? { ...inputs, style_images: { urls, from: "upload" }, style: { kind: "images" } }
      : { ...inputs, style_images: undefined };
  }
  // Only ever set from save_competitor_reference's own returned id (the
  // model is told never to invent one); it goes first, so it shapes the copy.
  const competitorId =
    typeof input.competitor_reference_id === "string" ? input.competitor_reference_id.trim() : "";
  if (competitorId) {
    inputs = {
      ...inputs,
      competitor_reference_ids: [
        competitorId,
        ...(inputs.competitor_reference_ids ?? []).filter((id) => id !== competitorId),
      ],
    };
  }
  const client = input.client_brand ? cleanClientBrand(input.client_brand, isHttpUrl) : null;
  if (client) next.client_brand = client;
  // Campaign mode is an explicit enum, entered and left deliberately:
  // "single" drops the whole campaign interview state (kind, products,
  // count) so the generate_content guard stops refusing.
  if (input.campaign_kind === "single") {
    delete next.campaign_kind;
    delete next.campaign_products;
    delete next.email_count;
  } else if (input.campaign_kind && CAMPAIGN_KINDS.includes(input.campaign_kind)) {
    next.campaign_kind = input.campaign_kind;
  }
  return withInputs(next, inputs);
}

/**
 * The user's own side of the conversation, verbatim, for the brief.
 *
 * update_brief gives generation the model's SUMMARY of what was said, which
 * is where the voice goes flat: the details, the asides, and the phrasing that
 * made the request specific don't survive being squeezed into `key_message`.
 * This keeps the raw text alongside it. User turns only (the assistant's own
 * questions are noise to a writer), oldest first, capped from the END so the
 * most recent, most specific answers always survive the cap.
 */
export function buildConversationNotes(
  history: { role: "user" | "assistant"; content: string }[] | undefined,
  latest: string,
): string {
  const lines = [...(history ?? []), { role: "user" as const, content: latest }]
    .filter((m) => m.role === "user" && m.content.trim())
    // The brief-state preamble the route prepends to each turn is our own
    // scaffolding, not something the user said.
    .map((m) => m.content.split("USER MESSAGE:").pop()!.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const joined = lines.join("\n---\n");
  return joined.length > MAX_CONVERSATION_NOTES_CHARS
    ? joined.slice(joined.length - MAX_CONVERSATION_NOTES_CHARS)
    : joined;
}
