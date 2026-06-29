import type { Brand, Icp } from "@/lib/db/types";

// Builds the reusable brand-voice context block injected into every generation
// prompt: voice, tone, example posts, banned terms, and the primary audience.
// Kept separate so blog generation (Slice 5) can reuse it verbatim.
export function buildBrandVoiceBlock(brand: Brand, icp: Icp | null): string {
  const v = brand.voice_profile ?? {};
  const lines: string[] = [];

  lines.push(`BRAND: ${brand.name}`);
  if (v.voice) lines.push(`VOICE: ${v.voice}`);
  if (v.tone) lines.push(`TONE: ${v.tone}`);

  if (v.example_posts?.length) {
    lines.push("");
    lines.push("EXAMPLES OF THE BRAND'S VOICE (match this register, not the topic):");
    v.example_posts.forEach((ex, i) => lines.push(`  ${i + 1}. ${ex}`));
  }

  if (v.banned_terms?.length) {
    lines.push("");
    lines.push(
      `BANNED TERMS, never use these words or phrases: ${v.banned_terms.join(", ")}.`,
    );
  }

  if (icp) {
    const p = icp.profile ?? {};
    lines.push("");
    lines.push(`PRIMARY AUDIENCE, "${icp.label}":`);
    if (p.demographics) lines.push(`  Who: ${p.demographics}`);
    if (p.pains?.length) lines.push(`  Pains: ${p.pains.join("; ")}`);
    if (p.objections?.length) lines.push(`  Objections: ${p.objections.join("; ")}`);
    if (p.vocabulary?.length) {
      lines.push(
        `  Use their words (not jargon): ${p.vocabulary.join(", ")}.`,
      );
    }
  }

  return lines.join("\n");
}

// Builds the positioning context block: what the business is, its tagline, what
// sets it apart, and who it's up against. Injected into generation prompts so
// the copy reflects the brand's actual positioning (not a guess).
export function buildPositioningBlock(brand: Brand): string {
  const p = brand.positioning ?? {};
  if (
    !p.business_description &&
    !p.tagline &&
    !p.differentiators?.length &&
    !p.competitors?.length
  ) {
    return "";
  }

  const lines: string[] = ["POSITIONING:"];
  if (p.tagline) lines.push(`  Tagline: ${p.tagline}`);
  if (p.business_description) lines.push(`  What we do: ${p.business_description}`);
  if (p.differentiators?.length) {
    lines.push(`  What sets us apart: ${p.differentiators.join("; ")}`);
  }
  if (p.competitors?.length) {
    lines.push(`  Competitors (differentiate from these, don't name-call): ${p.competitors.join(", ")}`);
  }
  return lines.join("\n");
}
