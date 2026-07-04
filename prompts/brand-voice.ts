import type {
  Brand,
  CampaignBrief,
  Icp,
  VoiceExampleChannel,
} from "@/lib/db/types";

// Builds the reusable brand-voice context block injected into every generation
// prompt: voice, tone, example posts, banned terms, and the primary audience.
// Kept separate so blog generation (Slice 5) can reuse it verbatim.
// When a channel is given, channel-tagged examples (voice_profile.examples) are
// preferred; untagged example_posts remain the fallback.
export function buildBrandVoiceBlock(
  brand: Brand,
  icp: Icp | null,
  channel?: VoiceExampleChannel,
): string {
  const v = brand.voice_profile ?? {};
  const lines: string[] = [];

  lines.push(`BRAND: ${brand.name}`);
  if (v.voice) lines.push(`VOICE: ${v.voice}`);
  if (v.tone) lines.push(`TONE: ${v.tone}`);

  const tagged = (v.examples ?? []).filter(
    (e) => !channel || e.channel === channel,
  );
  const examples = tagged.length
    ? tagged.map((e) => e.content)
    : v.example_posts ?? [];
  if (examples.length) {
    lines.push("");
    lines.push("EXAMPLES OF THE BRAND'S VOICE (match this register, not the topic):");
    examples.forEach((ex, i) => lines.push(`  ${i + 1}. ${ex}`));
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

// Builds the approved brand-guidelines block. When guidelines exist they are
// the top-of-prompt source of truth; voice/positioning blocks stay as
// supporting detail. Empty string when nothing has been saved yet.
export function buildGuidelinesBlock(brand: Brand): string {
  const g = brand.guidelines ?? {};
  const hasContent =
    g.voice_and_tone ||
    g.messaging_pillars?.length ||
    g.do_language?.length ||
    g.dont_language?.length ||
    g.audience_summary ||
    g.cta_philosophy;
  if (!hasContent) return "";

  const lines: string[] = [
    "BRAND GUIDELINES (human-approved; this is the DEFAULT direction when the",
    "user hasn't said otherwise for this piece. If the user's own brief,",
    "feedback, or instruction for THIS piece explicitly asks for something",
    "different, e.g. a different color, tone, or angle, honor their explicit",
    "request: they are intentionally overriding the default, that's allowed",
    "and expected. Guidelines fill the gaps, they don't overrule a direct ask.):",
  ];
  if (g.voice_and_tone) lines.push(`  Voice and tone: ${g.voice_and_tone}`);
  if (g.audience_summary) lines.push(`  Audience: ${g.audience_summary}`);
  if (g.messaging_pillars?.length) {
    lines.push(`  Messaging pillars: ${g.messaging_pillars.join("; ")}`);
  }
  if (g.do_language?.length) {
    lines.push(`  Say things like: ${g.do_language.join("; ")}`);
  }
  if (g.dont_language?.length) {
    lines.push(`  Never say things like: ${g.dont_language.join("; ")}`);
  }
  if (g.cta_philosophy) lines.push(`  Calls to action: ${g.cta_philosophy}`);
  return lines.join("\n");
}

// Builds the campaign brief block from the strategic interview. This is what
// the human said they want THIS piece to achieve; it steers the draft without
// overriding brand voice.
export function buildCampaignBriefBlock(brief: CampaignBrief | null): string {
  if (!brief) return "";
  const lines: string[] = [];
  if (brief.goal) lines.push(`  Goal: ${brief.goal}`);
  if (brief.audience_notes) lines.push(`  Audience notes: ${brief.audience_notes}`);
  if (brief.key_message) lines.push(`  Key message: ${brief.key_message}`);
  if (brief.angle) lines.push(`  Angle: ${brief.angle}`);
  if (brief.constraints) lines.push(`  Constraints: ${brief.constraints}`);
  if (!lines.length) return "";
  return ["CAMPAIGN BRIEF (from the strategy conversation; serve this):", ...lines].join(
    "\n",
  );
}
