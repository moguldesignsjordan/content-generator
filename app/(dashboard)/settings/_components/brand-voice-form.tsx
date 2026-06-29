"use client";

import { useState } from "react";
import { Button, Card, Field, Textarea } from "@/components/ui";
import type { VoiceProfile } from "@/lib/db/types";
import { ListInput } from "./list-input";

interface BrandVoiceFormProps {
  brandId: string;
  voiceProfile: VoiceProfile;
}

export function BrandVoiceForm({ brandId, voiceProfile }: BrandVoiceFormProps) {
  const [voice, setVoice] = useState(voiceProfile.voice ?? "");
  const [tone, setTone] = useState(voiceProfile.tone ?? "");
  const [examplePosts, setExamplePosts] = useState<string[]>(
    voiceProfile.example_posts ?? [],
  );
  const [bannedTerms, setBannedTerms] = useState<string[]>(
    voiceProfile.banned_terms ?? [],
  );
  const [ctaLibrary, setCtaLibrary] = useState({
    newsletter_signup: voiceProfile.cta_library?.newsletter_signup ?? "",
    portfolio: voiceProfile.cta_library?.portfolio ?? "",
    book_call: voiceProfile.cta_library?.book_call ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    try {
      const updated: VoiceProfile = {
        ...voiceProfile,
        voice,
        tone,
        example_posts: examplePosts.filter(Boolean),
        banned_terms: bannedTerms.filter(Boolean),
        cta_library: ctaLibrary,
      };
      const res = await fetch("/api/settings/brand-voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, voiceProfile: updated }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <Field
        label="Voice"
        hint="Describe the overall voice in 1 to 3 sentences. This goes directly into every generation prompt."
      >
        <Textarea
          rows={3}
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
        />
      </Field>

      <Field label="Tone" hint="How it feels, direct, warm, bold, etc.">
        <Textarea
          rows={2}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        />
      </Field>

      <ListInput
        label="Example posts"
        hint="Real emails or posts that sound like you. The single biggest quality lever, add at least 3."
        values={examplePosts}
        onChange={setExamplePosts}
        multiline
        placeholder="Paste an example post or email excerpt…"
      />

      <ListInput
        label="Banned terms"
        hint="Words and phrases Claude must never use."
        values={bannedTerms}
        onChange={setBannedTerms}
        placeholder="e.g. synergy"
      />

      <div className="space-y-3">
        <div>
          <p className="text-[13px] font-medium text-foreground/90">CTA library</p>
          <p className="mt-1 text-xs text-muted">
            The call-to-action text matched to each funnel stage. Write in brand
            voice.
          </p>
        </div>
        <CtaField
          label="Awareness → newsletter signup"
          value={ctaLibrary.newsletter_signup}
          onChange={(v) => setCtaLibrary((c) => ({ ...c, newsletter_signup: v }))}
        />
        <CtaField
          label="Consideration → portfolio"
          value={ctaLibrary.portfolio}
          onChange={(v) => setCtaLibrary((c) => ({ ...c, portfolio: v }))}
        />
        <CtaField
          label="Decision → book call"
          value={ctaLibrary.book_call}
          onChange={(v) => setCtaLibrary((c) => ({ ...c, book_call: v }))}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save brand voice
        </Button>
        {status === "saved" && <span className="text-sm text-success">Saved</span>}
        {status === "error" && (
          <span className="text-sm text-danger">Failed to save.</span>
        )}
      </div>
    </Card>
  );
}

function CtaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <Textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
