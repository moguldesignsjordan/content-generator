"use client";

import { AccentSpinner } from "@/components/ui";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";

export interface ResearchStep {
  id: string;
  status: "running" | "done" | "skipped" | "failed";
  label: string;
  detail?: string;
}

/**
 * The live research checklist, in the same look as the Create chat's
 * campaign run: check, spinner, shimmer. Skipped and failed steps say so
 * plainly and the run moves on.
 */
export function ResearchSteps({ target, steps }: { target: string; steps: ResearchStep[] }) {
  return (
    <div className="bubble-in overflow-hidden rounded-[22px] border border-border bg-surface-2">
      <div className="px-4 pb-3 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Researching</p>
        <p className="truncate text-[15px] font-semibold leading-snug text-foreground">{target}</p>
      </div>
      <ol className="space-y-2.5 px-4 pb-4" aria-live="polite">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-[14px]">
            <StepIcon status={s.status} />
            <span
              className={
                s.status === "running"
                  ? "text-shimmer font-medium"
                  : s.status === "done"
                    ? "text-foreground"
                    : "text-muted"
              }
            >
              {s.label}
              {s.detail && <span className="text-muted-2"> · {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted-2">
        Usually under a minute and a half. Nothing saves until you confirm.
      </p>
      <div className="h-[3px] overflow-hidden bg-surface-3">
        <div
          className="bg-spectrum h-full w-1/3 rounded-full"
          style={{ animation: "progress-indeterminate 1.3s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: ResearchStep["status"] }) {
  if (status === "running") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <AccentSpinner size={18} />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <CheckIcon size={13} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <CloseIcon size={12} />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border">
      <span className="h-px w-2.5 bg-muted-2" />
    </span>
  );
}
