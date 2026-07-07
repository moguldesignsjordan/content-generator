"use client";

import { useState } from "react";
import { Button, Sheet, Textarea } from "@/components/ui";
import { LightbulbIcon } from "@/components/ui/icons";
import type { SuggestField } from "@/prompts/suggest";

interface SuggestButtonProps {
  field: SuggestField;
  currentValue?: string | string[];
  /** Receives the (human-edited) suggestion text. The form decides how to apply it. */
  onApply: (value: string) => void;
  label?: string;
}

/**
 * "Suggest with AI", fetches a draft for one profile field and shows it in an
 * editable preview (a slide-up Sheet). Apply pushes the text into the parent
 * field's state; it is NOT persisted here. The human still clicks Save on the
 * form. This is the human-owned-brain guarantee: AI suggests, the human
 * approves and saves.
 */
export function SuggestButton({
  field,
  currentValue,
  onApply,
  label = "Suggest with AI",
}: SuggestButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function fetchSuggestion() {
    setLoading(true);
    setError(null);
    setOpen(true);
    setDraft("");
    try {
      const res = await fetch("/api/settings/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, currentValue }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { suggestion?: string; error?: string };
      if (data.error) throw new Error(data.error);
      setDraft(data.suggestion ?? "");
    } catch {
      setError("Couldn't generate a suggestion. Try writing it yourself.");
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setDraft("");
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={fetchSuggestion}
        disabled={loading || open}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent transition-colors hover:text-accent-press disabled:opacity-50"
      >
        <LightbulbIcon size={13} />
        {loading ? "Thinking…" : label}
      </button>

      <Sheet
        open={open}
        onClose={close}
        title="AI draft"
        description="Edit it, then apply. Nothing is saved until you hit Save."
        footer={
          <div className="flex gap-2">
            <Button
              variant="subtle"
              className="flex-1"
              onClick={close}
              disabled={loading}
            >
              Dismiss
            </Button>
            <Button
              variant="solid"
              className="flex-1"
              disabled={loading || !draft.trim()}
              onClick={() => {
                onApply(draft);
                close();
              }}
            >
              Apply
            </Button>
          </div>
        }
      >
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">Generating…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-danger">{error}</p>
        ) : (
          <Textarea
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="The AI draft will appear here. Edit it freely before applying."
          />
        )}
      </Sheet>
    </>
  );
}
