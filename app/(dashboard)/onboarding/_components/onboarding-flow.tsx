"use client";

import { useState } from "react";
import { MotionConfig } from "motion/react";
import type { OnboardingInput, OnboardingProposal } from "@/lib/db/types";
import type { ReadinessItem } from "@/lib/brand-readiness";
import { provisionalName } from "@/lib/onboarding/proposal";
import { readSse } from "@/lib/read-sse";
import { ScreenHeader } from "../../_components/screen-header";
import { FindStep } from "./find-step";
import { IdeasStep } from "./ideas-step";
import { ResearchSteps, type ResearchStep } from "./research-steps";
import { SnapshotStep } from "./snapshot-step";
import { VoiceStep } from "./voice-step";

export type FlowStep = "find" | "research" | "confirm" | "voice" | "ideas";

const HEADERS: Record<FlowStep, { title: string; subtitle: string }> = {
  find: {
    title: "Let's find your business",
    subtitle: "Your website is enough. We do the reading, you confirm.",
  },
  research: {
    title: "Looking you up",
    subtitle: "Reading your site and your reviews so you don't have to type it all in.",
  },
  confirm: {
    title: "Is this you?",
    subtitle: "Fix anything that's off, then tap Looks good.",
  },
  voice: {
    title: "Which sounds like you?",
    subtitle: "Pick the closest one. Tap a nudge to tune it.",
  },
  ideas: {
    title: "You're set",
    subtitle: "Your brand profile is saved. Here's where to start.",
  },
};

/**
 * Onboarding as tap-through cards: find, research, confirm, pick a voice,
 * three ideas. A reload resumes at the saved step (the server picks
 * initialStep from onboarding_state).
 */
export function OnboardingFlow({
  hasBrand,
  initialStep,
  input,
  proposal,
  todo,
}: {
  hasBrand: boolean;
  initialStep: FlowStep;
  input?: OnboardingInput;
  proposal?: OnboardingProposal;
  todo: ReadinessItem[];
}) {
  const [step, setStep] = useState<FlowStep>(initialStep);
  const [brandReady, setBrandReady] = useState(hasBrand);
  const [lastInput, setLastInput] = useState(input);
  const [current, setCurrent] = useState(proposal);
  const [steps, setSteps] = useState<ResearchStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  function go(next: FlowStep) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function research(next: OnboardingInput) {
    setLastInput(next);
    setError(null);
    setSteps([]);
    go("research");
    try {
      if (!brandReady) {
        const res = await fetch("/api/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: provisionalName(next) }),
        });
        if (!res.ok) throw new Error("Couldn't start your profile. Try again.");
        setBrandReady(true);
      }

      const res = await fetch("/api/onboarding/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Research hit a snag. Try again.");
      }
      const out: { proposal?: OnboardingProposal; error?: string } = {};
      await readSse(res, (event, data) => {
        if (event === "step") {
          const s = data as unknown as ResearchStep;
          setSteps((cur) =>
            cur.some((x) => x.id === s.id) ? cur.map((x) => (x.id === s.id ? s : x)) : [...cur, s],
          );
        } else if (event === "done") {
          out.proposal = data.proposal as OnboardingProposal;
        } else if (event === "error") {
          out.error = String(data.message ?? "");
        }
      });
      if (!out.proposal) throw new Error(out.error || "Research stopped early. Try again.");
      setCurrent(out.proposal);
      go("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research hit a snag. Try again.");
      go("find");
    }
  }

  const header = HEADERS[step];
  const target = lastInput?.url ?? lastInput?.name ?? "your business";

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-2xl">
        <StepDots step={step} />
        <ScreenHeader title={header.title} subtitle={header.subtitle} />

        {step === "find" && (
          <FindStep initial={lastInput} error={error} busy={false} onSubmit={research} />
        )}
        {step === "research" && <ResearchSteps target={target} steps={steps} />}
        {step === "confirm" && current && (
          <SnapshotStep
            proposal={current}
            onSaved={(confirmed) => {
              setCurrent(confirmed);
              go("voice");
            }}
          />
        )}
        {step === "voice" && (
          <VoiceStep initialSamples={current?.voice_samples ?? []} onDone={() => go("ideas")} />
        )}
        {step === "ideas" && <IdeasStep todo={todo} />}
      </div>
    </MotionConfig>
  );
}

const DOTS: FlowStep[] = ["find", "confirm", "voice", "ideas"];

/** Four dots, research counting as the first step. */
function StepDots({ step }: { step: FlowStep }) {
  const at = DOTS.indexOf(step === "research" ? "find" : step);
  return (
    <div className="mb-4 flex items-center gap-1.5" aria-label={`Step ${at + 1} of ${DOTS.length}`}>
      {DOTS.map((d, i) => (
        <span
          key={d}
          className={
            i <= at ? "h-1.5 w-6 rounded-full bg-accent" : "h-1.5 w-6 rounded-full bg-surface-3"
          }
        />
      ))}
    </div>
  );
}
