"use client";

import { useState } from "react";
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
    <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
      <Field label="Voice" hint="Describe the overall voice in 1–3 sentences. This goes directly into every generation prompt.">
        <textarea
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>

      <Field label="Tone" hint="How it feels — direct, warm, bold, etc.">
        <textarea
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </Field>

      <ListInput
        label="Example posts"
        hint="Real emails or posts that sound like you. The single biggest quality lever — add at least 3."
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
        <p className="text-xs uppercase tracking-wide text-muted">CTA Library</p>
        <p className="text-xs text-muted">
          The call-to-action text matched to each funnel stage. Write in brand voice.
        </p>
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

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save brand voice"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-emerald-400">Saved ✓</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">Failed to save.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
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
    <div>
      <label className="text-xs text-muted">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`mt-1 ${inputCls}`}
      />
    </div>
  );
}

const inputCls =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none resize-y";
