"use client";

import { useState } from "react";
import { Button, Card, Field, Textarea, useToast } from "@/components/ui";
import type { BrandGuidelines } from "@/lib/db/types";
import { ListInput } from "./list-input";

interface GuidelinesFormProps {
  brandId: string;
  guidelines: BrandGuidelines;
}

/**
 * Brand guidelines: synthesized by AI from everything stored, but the human
 * edits and explicitly saves. Generate only fills the form (a proposal); Save
 * is the single write path and stamps approved_at server-side.
 */
export function GuidelinesForm({ brandId, guidelines }: GuidelinesFormProps) {
  const g = guidelines ?? {};
  const [voiceAndTone, setVoiceAndTone] = useState(g.voice_and_tone ?? "");
  const [audienceSummary, setAudienceSummary] = useState(g.audience_summary ?? "");
  const [messagingPillars, setMessagingPillars] = useState(g.messaging_pillars ?? []);
  const [doLanguage, setDoLanguage] = useState(g.do_language ?? []);
  const [dontLanguage, setDontLanguage] = useState(g.dont_language ?? []);
  const [visualDirection, setVisualDirection] = useState(g.visual_direction ?? "");
  const [ctaPhilosophy, setCtaPhilosophy] = useState(g.cta_philosophy ?? "");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState(false);
  const toast = useToast();

  const approvedAt = g.approved_at
    ? new Date(g.approved_at).toLocaleDateString()
    : null;

  async function handleGenerate() {
    setGenerating(true);
    setProposed(false);
    try {
      const res = await fetch("/api/settings/guidelines", { method: "POST" });
      const data = (await res.json()) as {
        proposal?: BrandGuidelines;
        error?: string;
      };
      if (!res.ok || !data.proposal) throw new Error(data.error);
      const p = data.proposal;
      if (p.voice_and_tone) setVoiceAndTone(p.voice_and_tone);
      if (p.audience_summary) setAudienceSummary(p.audience_summary);
      if (p.messaging_pillars?.length) setMessagingPillars(p.messaging_pillars);
      if (p.do_language?.length) setDoLanguage(p.do_language);
      if (p.dont_language?.length) setDontLanguage(p.dont_language);
      if (p.visual_direction) setVisualDirection(p.visual_direction);
      if (p.cta_philosophy) setCtaPhilosophy(p.cta_philosophy);
      setProposed(true);
    } catch {
      toast.error("Couldn't generate a draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setProposed(false);
    try {
      const res = await fetch("/api/settings/guidelines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          guidelines: {
            voice_and_tone: voiceAndTone.trim() || undefined,
            audience_summary: audienceSummary.trim() || undefined,
            messaging_pillars: messagingPillars.filter(Boolean),
            do_language: doLanguage.filter(Boolean),
            dont_language: dontLanguage.filter(Boolean),
            visual_direction: visualDirection.trim() || undefined,
            cta_philosophy: ctaPhilosophy.trim() || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved and approved.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted">
          {approvedAt
            ? `Approved ${approvedAt}. These guidelines lead every generation prompt.`
            : "Not approved yet. Generate a draft from everything stored, edit it, then save."}
        </p>
        <Button
          variant="subtle"
          size="sm"
          loading={generating}
          onClick={handleGenerate}
        >
          ✨ {voiceAndTone || messagingPillars.length ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {proposed && (
        <p className="text-xs text-muted">
          Draft filled in below. Nothing is saved until you hit Save.
        </p>
      )}

      <Field
        label="Voice and tone"
        hint="How the brand sounds, and how that shifts by context."
      >
        <Textarea
          rows={4}
          value={voiceAndTone}
          onChange={(e) => setVoiceAndTone(e.target.value)}
        />
      </Field>

      <Field
        label="Audience summary"
        hint="Who the content serves and what they care about."
      >
        <Textarea
          rows={3}
          value={audienceSummary}
          onChange={(e) => setAudienceSummary(e.target.value)}
        />
      </Field>

      <ListInput
        label="Messaging pillars"
        values={messagingPillars}
        onChange={setMessagingPillars}
        multiline
        placeholder="Add a core message…"
      />

      <ListInput
        label="Say things like"
        values={doLanguage}
        onChange={setDoLanguage}
        placeholder="Add a phrase or framing…"
      />

      <ListInput
        label="Never say"
        values={dontLanguage}
        onChange={setDontLanguage}
        placeholder="Add a phrase to avoid…"
      />

      <Field
        label="Visual direction"
        hint="The visual feel: colors, type, layout attitude."
      >
        <Textarea
          rows={2}
          value={visualDirection}
          onChange={(e) => setVisualDirection(e.target.value)}
        />
      </Field>

      <Field
        label="CTA philosophy"
        hint="How the brand asks for action at each funnel stage."
      >
        <Textarea
          rows={2}
          value={ctaPhilosophy}
          onChange={(e) => setCtaPhilosophy(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save guidelines
        </Button>
      </div>
    </Card>
  );
}
