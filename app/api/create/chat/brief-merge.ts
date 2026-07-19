import { CAMPAIGN_BRIEF_TEXT_FIELDS, type CampaignBrief, type CampaignKind, type VisualVibe } from "@/lib/db/types";
import type { UpdateBriefInput } from "@/prompts/create-agent";
import { emailHtmlToText, stripEmDashes } from "@/lib/text";
import { MAX_BRIEF_PHOTOS } from "@/lib/email/brief-photos";
import { IMAGE_STYLE_CATALOG } from "@/lib/image-styles";
import { EMAIL_DESIGN_CATALOG } from "@/lib/design-styles";

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
  // A directly-typed URL still has to pass isHttpUrl; the model is told to
  // only ever echo one back from an upload notice, but this is the real
  // guard against an invented or malformed value landing in the brief.
  if (typeof input.product_photo_url === "string" && isHttpUrl(input.product_photo_url.trim())) {
    next.product_photo_url = input.product_photo_url.trim();
    next.include_image = true;
  }
  // Replace semantics (the model resends the whole list), same URL guard as
  // product_photo_url, deduped and capped so a runaway call can't balloon
  // the brief. An explicit empty array clears the list.
  if (Array.isArray(input.photo_urls)) {
    const urls = Array.from(
      new Set(
        input.photo_urls
          .filter((u): u is string => typeof u === "string")
          .map((u) => u.trim())
          .filter(isHttpUrl),
      ),
    ).slice(0, MAX_BRIEF_PHOTOS);
    if (urls.length) next.photo_urls = urls;
    else delete next.photo_urls;
  }
  if (input.use_ai_image_instead === true) {
    delete next.product_photo_url;
    delete next.photo_urls;
  }
  // Only ever set from save_competitor_reference's own returned id (the
  // model is told never to invent one); a non-empty-string guard is the real
  // check, same rigor as product_photo_url's URL guard for its own field.
  if (
    typeof input.competitor_reference_id === "string" &&
    input.competitor_reference_id.trim()
  ) {
    next.competitor_reference_id = input.competitor_reference_id.trim();
  }
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
  return next;
}
