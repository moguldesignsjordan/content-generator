"use client";

import { useEffect, useState } from "react";
import { AccentSpinner, Button, Card, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

// Lightweight, single-shot style adjustments for the current draft: "change
// the header BAR to a gradient", "make the headline text a gradient". Not a
// full regenerate (copy stays untouched, no new draft version), and not an
// agent (one cheap model call per instruction, no planning loop). Applies
// straight to the live preview; keeps a running log so it reads like a chat.
//
// History/undo is SERVER-authoritative (drafts.meta.style_edit_history), not
// just React state: it's fetched on mount and survives a reload. An edit you
// don't want is always recoverable, not just within the same browser tab.

type Entry = {
  instruction: string;
  status: "applying" | "done" | "error";
  error?: string;
  caveat?: string;
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
  const [redesigning, setRedesigning] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Hydrate from the server on mount so history/undo survive a reload.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/drafts/${draftId}/adjust-style`)
      .then((res) => res.json())
      .then((data: { html?: string; history?: { instruction: string }[] }) => {
        if (cancelled) return;
        if (data.history) {
          setEntries(data.history.map((h) => ({ instruction: h.instruction, status: "done" })));
          setCanUndo(data.history.length > 0);
        }
        if (data.html && data.html !== html) onHtmlChange(data.html);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
    // Only ever re-run if the draft itself changes, not on every html edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  async function handleApply() {
    const instruction = input.trim();
    if (!instruction || busy) return;
    setInput("");
    setBusy(true);
    setEntries((e) => [...e, { instruction, status: "applying" }]);

    try {
      const res = await fetch(`/api/drafts/${draftId}/adjust-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as {
        html?: string;
        history?: unknown[];
        caveat?: string;
        error?: string;
      };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that change.");
      }
      onHtmlChange(data.html);
      setCanUndo(true);
      setEntries((e) =>
        e.map((entry, i) =>
          i === e.length - 1 ? { ...entry, status: "done", caveat: data.caveat } : entry,
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

  async function handleRedesign() {
    if (redesigning || busy) return;
    // Whatever's typed in the box becomes an explicit creative override for
    // this redesign (e.g. "make it darker, purple accent instead"); empty
    // just reapplies the current brand tokens everywhere.
    const direction = input.trim();
    setInput("");
    setRedesigning(true);
    setEntries((e) => [
      ...e,
      {
        instruction: direction ? `Redesign: ${direction}` : "Redesign using current brand colors",
        status: "applying",
      },
    ]);
    try {
      const res = await fetch(`/api/drafts/${draftId}/redesign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: direction || undefined }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Redesign failed.");
      }
      onHtmlChange(data.html);
      setCanUndo(true);
      setEntries((e) =>
        e.map((entry, i) => (i === e.length - 1 ? { ...entry, status: "done" } : entry)),
      );
    } catch (err) {
      setEntries((e) =>
        e.map((entry, i) =>
          i === e.length - 1
            ? { ...entry, status: "error", error: err instanceof Error ? err.message : "Failed." }
            : entry,
        ),
      );
    } finally {
      setRedesigning(false);
    }
  }

  async function handleUndo() {
    if (!canUndo || undoing) return;
    setUndoing(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/adjust-style`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        html?: string;
        history?: unknown[];
        error?: string;
      };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't undo.");
      }
      onHtmlChange(data.html);
      setCanUndo((data.history?.length ?? 0) > 0);
      setEntries((e) => e.slice(0, -1));
    } catch {
      // Leave state as-is; the user can just try again.
    } finally {
      setUndoing(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-medium text-foreground">
            Adjust the design
          </p>
          <p className="text-[12.5px] text-muted">
            Describe a style change in plain words; the copy stays put.
            Redesign restyles the whole email from your brand colors (type a
            direction first, like &ldquo;darker, purple accent&rdquo;, to steer
            it).
          </p>
        </div>
        <Button
          variant="subtle"
          size="sm"
          loading={redesigning}
          disabled={busy || redesigning}
          onClick={handleRedesign}
          className="shrink-0"
        >
          Redesign
        </Button>
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
                {entry.caveat && (
                  <span className="block text-[12px] text-muted">
                    {entry.caveat}
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
          placeholder="e.g. Make the header bar a gradient from accent to primary"
          disabled={busy || !loaded}
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
      {canUndo && !busy && (
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoing}
          className="text-[12px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          {undoing ? "Undoing…" : "Undo last change"}
        </button>
      )}
    </Card>
  );
}
