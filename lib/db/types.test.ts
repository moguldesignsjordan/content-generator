import { describe, expect, it } from "vitest";
import { CAMPAIGN_BRIEF_TEXT_FIELDS, type CampaignBrief } from "./types";

// CampaignBrief fields that are strings at the type level but need their own
// enum/boolean validation at every save site, so they deliberately don't
// belong in the generic stripEmDashes-and-copy allowlist (see
// CAMPAIGN_BRIEF_TEXT_FIELDS's doc comment in ./types.ts).
type NonTextField =
  | "length"
  | "include_image"
  | "visual_vibe"
  | "image_style"
  | "email_style"
  | "product_photo_url"
  | "photo_urls"
  | "use_ai_image_instead"
  | "style_example"
  | "campaign_kind";

type ExpectedTextField = Exclude<keyof CampaignBrief, NonTextField>;
type ListedField = (typeof CAMPAIGN_BRIEF_TEXT_FIELDS)[number];

// Compile-time exhaustiveness check, both directions. Wrapped in a tuple so
// the union doesn't distribute (an un-tupled `A extends B` over a union type
// checks member-by-member and silently drops a failing member as `never`
// instead of failing the whole check).
//
// If a future plain-text field is added to CampaignBrief without adding it
// here (or to NonTextField above, when it genuinely needs special handling),
// _assertNoMissingField fails to typecheck: this is the allowlist-drift bug
// class (silently dropped at chat mergeBrief / seriesBrief / flyerBrief /
// AUTO_MODE_LINES) turned into a `npm run typecheck` failure instead of a
// silent runtime no-op.
type AssertNoMissingField = [ExpectedTextField] extends [ListedField] ? true : never;
type AssertNoExtraField = [ListedField] extends [ExpectedTextField] ? true : never;
const _assertNoMissingField: AssertNoMissingField = true;
const _assertNoExtraField: AssertNoExtraField = true;
void _assertNoMissingField;
void _assertNoExtraField;

describe("CAMPAIGN_BRIEF_TEXT_FIELDS", () => {
  it("has no duplicate entries", () => {
    expect(new Set(CAMPAIGN_BRIEF_TEXT_FIELDS).size).toBe(CAMPAIGN_BRIEF_TEXT_FIELDS.length);
  });
});
