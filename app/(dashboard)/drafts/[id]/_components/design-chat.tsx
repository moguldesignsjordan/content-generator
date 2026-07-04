"use client";

import { useState } from "react";
import { AccentSpinner, Button, Card, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

// Lightweight, single-shot style adjustments for the current draft: "change
// the header to a gradient", "make the background darker". Not a full
// regenerate (copy stays untouched, no new draft version), and not an agent
// (one cheap model call per instruction, no planning loop). Applies straight
// to the live preview; keeps a running log so it reads like a chat.

type Entry = {
  instruction: string;
  status: "applying" | "done" | "error";
  error?: string;
};

interface DesignChatProps {
  draftId: string;
  html: string;
  onHtmlChange: (html: string) => void;
}

export function DesignChat({ draftId, html, onHtmlChange }: DesignChatProps) {
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  // One-step undo: the html right before the most recent successful apply.
  const [previousHtml, setPreviousHtml] = useState<string | null>(null);

  async function handleApply() {
    const instruction = input.trim();
    if (!instruction || busy) return;
    setInput("");
    setBusy(true);
    setEntries((e) => [...e, { instruction, status: "applying" }]);
    const beforeHtml = html;

    try {
      const res = await fetch(`/api/drafts/${draftId}/adjust-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that change.");
      }
      setPreviousHtml(beforeHtml);
      onHtmlChange(data.html);
      setEntries((e) =>
        e.map((entry, i) =>
          i === e.length - 1 ? { ...entry, status: "done" } : entry,
        ),
      );
    } catch (err) {
      setEntries((e) =>
        e.map((entry, i) =>
          i === e.length - 1
            ? {
                ...entry,
                status: "error",
                error: err instanceof Error ? err.message : "Failed.",
              }
            : entry,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleUndo() {
    if (previousHtml === null) return;
    onHtmlChange(previousHtml);
    setPreviousHtml(null);
    setEntries((e) => [
      ...e,
      { instruction: "Undo last change", status: "done" },
    ]);
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="text-[13.5px] font-medium text-foreground">
          Adjust the design
        </p>
        <p className="text-[12.5px] text-muted">
          Style only, in plain words: colors, gradients, spacing, header
          treatment. Copy doesn&apos;t change and this doesn&apos;t use a
          draft version.
        </p>
      </div>

      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-[13px] leading-snug"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0",
                  entry.status === "done" && "text-success",
                  entry.status === "error" && "text-danger",
                  entry.status === "applying" && "text-muted",
                )}
              >
                {entry.status === "applying" ? (
                  <AccentSpinner size={14} />
                ) : entry.status === "done" ? (
                  "✓"
                ) : (
                  "✕"
                )}
              </span>
              <span className="text-foreground">
                {entry.instruction}
                {entry.status === "error" && entry.error && (
                  <span className="block text-[12px] text-danger">
                    {entry.error}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          placeholder="e.g. Make the header a gradient from accent to primary"
          disabled={busy}
        />
        <Button
          variant="gradient"
          size="sm"
          loading={busy}
          disabled={!input.trim()}
          onClick={handleApply}
        >
          Apply
        </Button>
      </div>
      {previousHtml !== null && !busy && (
        <button
          type="button"
          onClick={handleUndo}
          className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Undo last change
        </button>
      )}
    </Card>
  );
}
