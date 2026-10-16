"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ChatQuestion, QuestionAnswer } from "@/lib/create-questions";
import { LookPicker } from "./look-picker";

/** An answer chip in the thread: lifts toward the brand light on hover. */
export const CHIP_CLASS =
  "rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-foreground transition-[border-color,box-shadow,transform] duration-200 hover:border-accent/45 hover:shadow-[0_0_24px_-12px_rgba(255,61,140,0.5)] active:scale-[0.97] disabled:opacity-50";

/** One tappable answer, styled like the agent's chips. */
export function StepChip({
  label,
  onClick,
  disabled,
  primary,
  pressed,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Set for multi-select chips. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50",
        primary
          ? "border-accent bg-accent text-white hover:bg-accent-press"
          : pressed
            ? "border-accent/40 bg-accent/[0.12] text-foreground"
            : CHIP_CLASS,
      )}
    >
      {label}
    </button>
  );
}

const LOOK_LABELS: Record<string, string> = {
  our: "Our style",
  none: "No reference, you pick",
  images: "Follow the designs I added",
  ads: "Follow the ads I picked",
};

/**
 * The follow-up questions as one card: each with its own tap answers (one or
 * several) and a "Type it" field, and one Send. The style question hosts the
 * look picker; the photos question points at the paperclip. Typing in the
 * composer instead still works.
 */
export function QuestionCard({
  questions,
  disabled,
  lookId,
  onLookChange,
  lookTouched,
  styleImages,
  adPicks,
  onAdPicks,
  onSend,
}: {
  questions: ChatQuestion[];
  disabled: boolean;
  lookId: string | null;
  onLookChange: (value: string | null) => void;
  /** True once they tapped a look in this card. */
  lookTouched: boolean;
  styleImages: { urls: string[]; from: "upload" | "competitor" } | null;
  adPicks: string[];
  onAdPicks: (ids: string[]) => void;
  onSend: (text: string, answers: QuestionAnswer[], lookChoice?: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});

  function toggle(q: ChatQuestion, value: string) {
    setPicked((cur) => {
      const now = cur[q.id] ?? [];
      const next = q.multi
        ? now.includes(value)
          ? now.filter((v) => v !== value)
          : [...now, value]
        : now[0] === value
          ? []
          : [value];
      return { ...cur, [q.id]: next };
    });
  }

  const lookLabel = lookId === null ? LOOK_LABELS.our : (LOOK_LABELS[lookId] ?? "A saved look");
  const lines: string[] = [];
  const answers: QuestionAnswer[] = [];
  for (const q of questions) {
    const values = picked[q.id] ?? [];
    const own = typed[q.id]?.trim() ?? "";
    const labels = values.map((v) => q.choices.find((c) => c.value === v)?.label ?? v);
    const parts = [...labels, ...(own ? [own] : [])];
    if (q.id === "style" && lookTouched) parts.unshift(lookLabel);
    if (!parts.length) continue;
    lines.push(`${q.question} ${parts.join(", ")}`);
    // A typed product name is a product too.
    answers.push({ id: q.id, values: q.id === "products" && own ? [...values, own] : values });
  }
  const hasStyle = questions.some((q) => q.id === "style");

  return (
    <div className="bubble-in space-y-4 rounded-[22px] border border-border bg-surface-2 p-3.5 sm:ml-9">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        <span className="bar-spectrum h-1 w-4 rounded-full" />
        A few quick things
      </span>
      {questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <p className="text-sm font-medium text-foreground">{q.question}</p>
          {q.id === "style" && (
            <LookPicker
              value={lookId}
              onChange={onLookChange}
              styleImages={styleImages}
              adPicks={adPicks}
              onAdPicks={onAdPicks}
            />
          )}
          {q.id === "photos" && (
            <p className="text-xs text-muted">
              Tap the paperclip below the chat to add them. No photos is fine too: the pictures get made
              in your brand colors.
            </p>
          )}
          {(q.choices.length > 0 || q.id !== "style") && (
            <div className="flex flex-wrap gap-2">
              {q.choices.map((c) => (
                <StepChip
                  key={c.value}
                  label={c.label}
                  pressed={(picked[q.id] ?? []).includes(c.value)}
                  onClick={() => toggle(q, c.value)}
                  disabled={disabled}
                />
              ))}
              {!typing[q.id] && q.id !== "photos" && (
                <StepChip
                  label={q.id === "products" ? "+ Add" : "Type it"}
                  onClick={() => setTyping((cur) => ({ ...cur, [q.id]: true }))}
                  disabled={disabled}
                />
              )}
            </div>
          )}
          {typing[q.id] && (
            <input
              autoFocus
              value={typed[q.id] ?? ""}
              onChange={(e) => setTyped((cur) => ({ ...cur, [q.id]: e.target.value }))}
              placeholder={q.id === "products" ? "Product name" : "Your answer"}
              maxLength={200}
              disabled={disabled}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-2 focus:border-accent/50 focus:outline-none"
            />
          )}
        </div>
      ))}
      <StepChip
        primary
        label="Send answers"
        disabled={disabled || !lines.length}
        onClick={() =>
          onSend(
            lines.join("\n"),
            answers,
            hasStyle && lookTouched ? (lookId ?? "our") : undefined,
          )
        }
      />
    </div>
  );
}
