"use client";

import { Field, Textarea } from "@/components/ui";
import type { BrandGuidelines } from "@/lib/db/types";
import { ListInput } from "./list-input";

// The editable shape of a BrandGuidelines proposal/draft, shared by the
// Settings sheet (guidelines-form.tsx) and the brand-guidelines document
// route's "not generated yet" state, so there's exactly one place that
// defines these seven fields.
export interface GuidelinesValue {
  voiceAndTone: string;
  audienceSummary: string;
  messagingPillars: string[];
  doLanguage: string[];
  dontLanguage: string[];
  visualDirection: string;
  ctaPhilosophy: string;
}

export function guidelinesValueFromBrand(g: BrandGuidelines | undefined): GuidelinesValue {
  const source = g ?? {};
  return {
    voiceAndTone: source.voice_and_tone ?? "",
    audienceSummary: source.audience_summary ?? "",
    messagingPillars: source.messaging_pillars ?? [],
    doLanguage: source.do_language ?? [],
    dontLanguage: source.dont_language ?? [],
    visualDirection: source.visual_direction ?? "",
    ctaPhilosophy: source.cta_philosophy ?? "",
  };
}

/** Merges a freshly-generated proposal onto the current value; blank/empty fields don't clobber existing edits. */
export function applyGuidelinesProposal(
  value: GuidelinesValue,
  proposal: BrandGuidelines,
): GuidelinesValue {
  return {
    voiceAndTone: proposal.voice_and_tone ?? value.voiceAndTone,
    audienceSummary: proposal.audience_summary ?? value.audienceSummary,
    messagingPillars: proposal.messaging_pillars?.length
      ? proposal.messaging_pillars
      : value.messagingPillars,
    doLanguage: proposal.do_language?.length ? proposal.do_language : value.doLanguage,
    dontLanguage: proposal.dont_language?.length ? proposal.dont_language : value.dontLanguage,
    visualDirection: proposal.visual_direction ?? value.visualDirection,
    ctaPhilosophy: proposal.cta_philosophy ?? value.ctaPhilosophy,
  };
}

export function guidelinesValueToPayload(value: GuidelinesValue): BrandGuidelines {
  return {
    voice_and_tone: value.voiceAndTone.trim() || undefined,
    audience_summary: value.audienceSummary.trim() || undefined,
    messaging_pillars: value.messagingPillars.filter(Boolean),
    do_language: value.doLanguage.filter(Boolean),
    dont_language: value.dontLanguage.filter(Boolean),
    visual_direction: value.visualDirection.trim() || undefined,
    cta_philosophy: value.ctaPhilosophy.trim() || undefined,
  };
}

/**
 * The seven editable guidelines fields: voice/tone, audience, messaging
 * pillars, do/don't language, visual direction, CTA philosophy. Purely
 * controlled, no fetch/save wiring, so callers (Settings sheet, the
 * brand-guidelines document route) own the Generate/Save chrome around it.
 */
export function GuidelinesFields({
  value,
  onChange,
}: {
  value: GuidelinesValue;
  onChange: (value: GuidelinesValue) => void;
}) {
  const set = <K extends keyof GuidelinesValue>(key: K, v: GuidelinesValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-5">
      <Field
        label="Voice and tone"
        hint="How the brand sounds, and how that shifts by context."
      >
        <Textarea
          rows={4}
          value={value.voiceAndTone}
          onChange={(e) => set("voiceAndTone", e.target.value)}
        />
      </Field>

      <Field
        label="Audience summary"
        hint="Who the content serves and what they care about."
      >
        <Textarea
          rows={3}
          value={value.audienceSummary}
          onChange={(e) => set("audienceSummary", e.target.value)}
        />
      </Field>

      <ListInput
        label="Messaging pillars"
        values={value.messagingPillars}
        onChange={(v) => set("messagingPillars", v)}
        multiline
        placeholder="Add a core message…"
      />

      <ListInput
        label="Say things like"
        values={value.doLanguage}
        onChange={(v) => set("doLanguage", v)}
        placeholder="Add a phrase or framing…"
      />

      <ListInput
        label="Never say"
        values={value.dontLanguage}
        onChange={(v) => set("dontLanguage", v)}
        placeholder="Add a phrase to avoid…"
      />

      <Field
        label="Visual direction"
        hint="The visual feel: colors, type, layout attitude."
      >
        <Textarea
          rows={2}
          value={value.visualDirection}
          onChange={(e) => set("visualDirection", e.target.value)}
        />
      </Field>

      <Field
        label="CTA philosophy"
        hint="How the brand asks for action at each funnel stage."
      >
        <Textarea
          rows={2}
          value={value.ctaPhilosophy}
          onChange={(e) => set("ctaPhilosophy", e.target.value)}
        />
      </Field>
    </div>
  );
}
