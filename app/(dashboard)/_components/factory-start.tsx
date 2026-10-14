"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Card, SegmentedControl, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { readSse } from "@/lib/read-sse";
import type { FactoryKind } from "@/lib/db/types";
import { FACTORY_KINDS, FACTORY_KIND_LABELS } from "@/prompts/campaign-formats";

// The factory's front door: one sentence, what to make, how many, over how
// long. Submitting researches and plans (nothing is generated yet) and opens
// the campaign's plan table.

const STEPS = [
  { phase: "researching", label: "Researching trends and competitors" },
  { phase: "planning", label: "Planning the pieces" },
  { phase: "pricing", label: "Pricing the batch" },
];

type Size = "6" | "12" | "20";
type Days = "14" | "30";

export function FactoryStart({ hasWebsite }: { hasWebsite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sentence, setSentence] = useState("");
  const [kinds, setKinds] = useState<FactoryKind[]>([...FACTORY_KINDS]);
  const [size, setSize] = useState<Size>("12");
  const [days, setDays] = useState<Days>("30");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; outOfCredits?: boolean } | null>(null);

  function toggleKind(kind: FactoryKind) {
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "product");
      const res = await fetch("/api/uploads/image", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't upload that photo.");
      setPhotoUrl(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  async function start() {
    setRunning(true);
    setError(null);
    setPhase(STEPS[0].phase);
    try {
      const res = await fetch("/api/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence,
          kinds,
          size: Number(size),
          days: Number(days),
          ...(photoUrl ? { photo_url: photoUrl } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          outOfCredits?: boolean;
        };
        throw Object.assign(new Error(data.error ?? "Couldn't start the campaign."), {
          outOfCredits: data.outOfCredits,
        });
      }
      let campaignId: string | null = null;
      let failure: string | null = null;
      await readSse(res, (event, data) => {
        if (event === "phase" && typeof data.phase === "string") setPhase(data.phase);
        else if (event === "done" && typeof data.campaignId === "string") campaignId = data.campaignId;
        else if (event === "error") failure = String(data.message ?? "Couldn't plan the campaign.");
      });
      if (failure) throw new Error(failure);
      if (!campaignId) throw new Error("The connection dropped before the plan was ready. Try again.");
      router.push(`/campaigns/${campaignId}`);
    } catch (e) {
      const err = e as Error & { outOfCredits?: boolean };
      setError({ message: err.message, outOfCredits: err.outOfCredits });
      setRunning(false);
      setPhase(null);
    }
  }

  const activeIndex = STEPS.findIndex((s) => s.phase === phase);
  const canStart = sentence.trim().length > 0 && kinds.length > 0 && !uploading && !running;

  return (
    <Card className="space-y-6 p-5 md:p-7">
      <div className="space-y-2">
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-tight md:text-[34px]">
          What are you promoting?
        </h1>
        <p className="text-[15px] text-muted">
          One sentence is enough. It researches what's working in your niche, then shows you a plan
          to edit before anything is made.
        </p>
      </div>

      <Textarea
        id="factory-sentence"
        rows={3}
        value={sentence}
        disabled={running}
        onChange={(e) => setSentence(e.target.value)}
        placeholder="e.g. Our new website care plan: $49 a month, starts November 1"
        maxLength={500}
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          id="factory-photo"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadPhoto(file);
            e.target.value = "";
          }}
        />
        {photoUrl ? (
          <div className="flex items-center gap-3">
            {/* Supabase Storage URL; next/image would need remotePatterns for it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Product photo" className="h-12 w-12 rounded-[var(--radius-sm)] object-cover" />
            <Button variant="ghost" size="sm" disabled={running} onClick={() => setPhotoUrl(null)}>
              Remove photo
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            loading={uploading}
            disabled={running}
            onClick={() => fileRef.current?.click()}
          >
            Add a product photo
          </Button>
        )}
        <span className="text-[13px] text-muted">
          Optional. Flyers and ads will show the real thing.
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-foreground">Make</p>
        <div className="flex flex-wrap gap-2">
          {FACTORY_KINDS.map((kind) => {
            const on = kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                disabled={running}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "h-9 rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                  on
                    ? "border-accent/40 bg-accent/[0.12] text-foreground"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                {FACTORY_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-foreground">How many pieces</p>
          <SegmentedControl<Size>
            value={size}
            onChange={setSize}
            options={[
              { value: "6", label: "6" },
              { value: "12", label: "12 (recommended)" },
              { value: "20", label: "20" },
            ]}
          />
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-foreground">Spread over</p>
          <SegmentedControl<Days>
            value={days}
            onChange={setDays}
            options={[
              { value: "14", label: "2 weeks" },
              { value: "30", label: "30 days (recommended)" },
            ]}
          />
        </div>
      </div>

      {running ? (
        <ol className="space-y-2.5" aria-live="polite">
          {STEPS.map((step, i) => (
            <li key={step.phase} className="flex items-center gap-3 text-[14px]">
              {i < activeIndex ? (
                <span className="flex h-5 w-5 items-center justify-center text-success">✓</span>
              ) : i === activeIndex ? (
                <AccentSpinner size={18} className="mx-px" />
              ) : (
                <span className="h-5 w-5" />
              )}
              <span className={i <= activeIndex ? "text-foreground" : "text-muted"}>
                {step.label}
              </span>
            </li>
          ))}
          <li className="pl-8 text-[13px] text-muted">This takes a minute or two.</li>
        </ol>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="gradient" size="lg" disabled={!canStart} onClick={start}>
            Plan my campaign
          </Button>
          <span className="text-[13px] text-muted">
            {hasWebsite
              ? "Uses a few web searches and reads your site. Nothing is made until you approve the plan."
              : "Uses a few web searches. Add your website in Settings so it can pull real facts."}
          </span>
        </div>
      )}

      {error && (
        <p className="text-[14px] text-danger" role="alert">
          {error.message}{" "}
          {error.outOfCredits && (
            <a href="/billing" className="font-medium underline">
              Top up credits
            </a>
          )}
        </p>
      )}
    </Card>
  );
}
