"use client";

import { useEffect, useState } from "react";
import { AccentSpinner, Button, Input, LinkButton, Sheet } from "@/components/ui";
import { ApiError } from "@/lib/billing/toast-error";

// The AI rewrite, as a deliberate step instead of a surprise.
//
// The old flow ran "Rewrite it for me" straight into the document: the model
// returned HTML patches, they were committed, and you found out what happened
// by looking at your email afterwards. Now the model returns TEXT, this modal
// shows it against what is currently there, and nothing is written until the
// user picks "Use this". "Try again" re-rolls; "Cancel" leaves the draft
// untouched.
//
// Shared by email and blog — the proposal is just words either way.

const CHIPS = ["Punchier", "Shorter", "Warmer", "More specific"];

interface RewriteModalProps {
  open: boolean;
  label: string;
  currentText: string;
  onClose: () => void;
  /** Asks the model for a proposal. Must not commit anything. */
  onRequest: (instruction?: string) => Promise<string>;
  /** The user accepted this text. */
  onAccept: (text: string) => Promise<void>;
}

export function RewriteModal({
  open,
  label,
  currentText,
  onClose,
  onRequest,
  onAccept,
}: RewriteModalProps) {
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInstruction("");
      setProposed(null);
      setError(null);
      setUpgradeUrl(null);
      setLoading(false);
      setApplying(false);
    }
  }, [open]);

  async function request(withInstruction?: string) {
    setLoading(true);
    setError(null);
    setUpgradeUrl(null);
    try {
      const text = await onRequest(withInstruction ?? (instruction.trim() || undefined));
      setProposed(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write a new version.");
      if (err instanceof ApiError && err.outOfCredits) setUpgradeUrl(err.upgradeUrl ?? "/billing");
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!proposed) return;
    setApplying(true);
    setError(null);
    setUpgradeUrl(null);
    try {
      await onAccept(proposed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply that.");
      if (err instanceof ApiError && err.outOfCredits) setUpgradeUrl(err.upgradeUrl ?? "/billing");
      setApplying(false);
    }
  }

  const busy = loading || applying;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Rewrite: ${label}`}
      description="Nothing changes until you choose to use it."
    >
      <div className="flex items-end gap-2">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void request();
          }}
          placeholder="How should it change? (optional)"
          disabled={busy}
        />
        <Button
          variant="gradient"
          size="sm"
          loading={loading}
          disabled={busy}
          onClick={() => void request()}
        >
          {proposed ? "Try again" : "Write it"}
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => {
              setInstruction(chip);
              void request(chip);
            }}
            className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">Current</p>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-[13.5px] leading-relaxed text-foreground">
            {currentText}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">Proposed</p>
          <div className="max-h-52 min-h-[64px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-accent/40 bg-accent/5 p-3 text-[13.5px] leading-relaxed text-foreground">
            {loading ? (
              <span className="flex items-center gap-2 text-muted">
                <AccentSpinner size={13} /> Writing…
              </span>
            ) : proposed ? (
              proposed
            ) : (
              <span className="text-muted">
                Pick a direction above, or just press &ldquo;Write it&rdquo;.
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-danger">{error}</p>
          {upgradeUrl && (
            <LinkButton href={upgradeUrl} variant="gradient" size="sm">
              Buy credits
            </LinkButton>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="gradient"
          size="sm"
          loading={applying}
          disabled={!proposed || busy}
          onClick={() => void accept()}
        >
          Use this
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
