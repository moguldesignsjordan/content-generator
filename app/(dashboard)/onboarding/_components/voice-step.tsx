"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { AccentSpinner, Badge, Button, Card, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { VoiceSample } from "@/lib/db/types";
import { VOICE_NUDGES } from "@/prompts/onboarding-voice";
import { StepChip } from "../../_components/question-card";
import { StickyAction } from "./sticky-action";

/**
 * Step 4, "Which sounds like you?": three short samples about one of their
 * real services. Tap one; nudges rewrite it in place; "None of these" takes
 * a few of their own words. "This is me" saves the voice and finishes.
 */
export function VoiceStep({
  initialSamples,
  onDone,
}: {
  initialSamples: VoiceSample[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [samples, setSamples] = useState(initialSamples);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState<"write" | "rewrite" | "save" | null>(null);
  const [ownWords, setOwnWords] = useState<string | null>(null);

  async function post(body: object): Promise<{ sample?: VoiceSample; samples?: VoiceSample[] }> {
    const res = await fetch("/api/onboarding/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sample?: VoiceSample;
      samples?: VoiceSample[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
    return data;
  }

  async function writeFresh() {
    setBusy("write");
    try {
      const data = await post({});
      setSamples(data.samples ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't write samples.");
    } finally {
      setBusy(null);
    }
  }

  async function rewrite(index: number, ask: string) {
    setBusy("rewrite");
    try {
      const data = await post({ sample: samples[index], ask });
      if (data.sample) {
        setSamples((cur) => cur.map((s, i) => (i === index ? data.sample! : s)));
        setPicked(index);
        setOwnWords(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rewrite it.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (picked === null) return;
    setBusy("save");
    try {
      const res = await fetch("/api/onboarding/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: samples[picked] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save your voice.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your voice.");
      setBusy(null);
    }
  }

  if (!samples.length) {
    return (
      <Card className="p-6 text-center">
        <p className="text-[15px] font-semibold text-foreground">We couldn&apos;t write your samples yet</p>
        <p className="mt-1.5 text-sm text-muted">Your profile is saved. Try once more and pick the voice that fits.</p>
        <Button variant="gradient" className="mt-5" loading={busy === "write"} onClick={writeFresh}>
          Write samples
        </Button>
      </Card>
    );
  }

  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {samples.map((s, i) => {
        const selected = picked === i;
        return (
          <Card
            key={i}
            className={cn(
              "overflow-hidden transition-[border-color,box-shadow]",
              selected && "border-accent shadow-[0_0_0_1px_var(--accent)]",
            )}
          >
            <button
              type="button"
              onClick={() => setPicked(i)}
              aria-pressed={selected}
              disabled={busy === "rewrite"}
              className="block w-full p-4 text-left sm:p-5"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-foreground">{s.name}</span>
                {s.from_site && <Badge tone="cyan">Sounds like your site</Badge>}
              </span>
              <span className="mt-2 block text-[15px] leading-relaxed text-foreground/90">{s.text}</span>
            </button>
            {selected && (
              <div className="border-t border-border px-4 py-3 sm:px-5">
                {busy === "rewrite" ? (
                  <p className="flex items-center gap-2 text-[13px] text-muted">
                    <AccentSpinner size={16} /> Rewriting
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {VOICE_NUDGES.map((nudge) => (
                      <StepChip key={nudge} label={nudge} onClick={() => rewrite(i, nudge)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {ownWords === null ? (
        <button
          type="button"
          onClick={() => setOwnWords("")}
          className="px-1 text-[13px] font-medium text-accent hover:underline"
        >
          None of these
        </button>
      ) : (
        <Card className="p-4 sm:p-5">
          <p className="text-[14px] font-semibold text-foreground">How should it sound?</p>
          <p className="mt-1 text-[12.5px] text-muted">A few words is plenty, e.g. &quot;straight talk, a bit funny&quot;.</p>
          <div className="mt-3 flex items-center gap-2">
            <Input
              autoFocus
              value={ownWords}
              onChange={(e) => setOwnWords(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ownWords.trim()) rewrite(picked ?? 0, ownWords.trim());
              }}
              className="h-10 text-[14px]"
            />
            <Button
              variant="subtle"
              size="sm"
              loading={busy === "rewrite"}
              disabled={!ownWords.trim()}
              onClick={() => rewrite(picked ?? 0, ownWords.trim())}
            >
              Rewrite
            </Button>
          </div>
        </Card>
      )}

      <StickyAction hint={picked === null ? "Tap the one that sounds most like you." : "You can fine-tune it later in Settings."}>
        <Button variant="gradient" loading={busy === "save"} disabled={picked === null || busy === "rewrite"} onClick={save}>
          This is me
        </Button>
      </StickyAction>
    </motion.div>
  );
}
