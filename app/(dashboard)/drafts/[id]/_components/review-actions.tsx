"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailDraftContent } from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";

interface ReviewActionsProps {
  draftId: string;
  version: number;
  initialContent: EmailDraftContent;
}

export function ReviewActions({
  draftId,
  version,
  initialContent,
}: ReviewActionsProps) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialContent.subject);
  const [preheader, setPreheader] = useState(initialContent.preheader);
  const [html, setHtml] = useState(initialContent.html);
  const [showHtmlEdit, setShowHtmlEdit] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEdited =
    subject !== initialContent.subject ||
    preheader !== initialContent.preheader ||
    html !== initialContent.html;

  const atCap = version >= MAX_DRAFT_VERSIONS;

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const body = isEdited
        ? { editedContent: { subject, preheader, html } }
        : {};
      const res = await fetch(`/api/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to approve.");
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve.");
      setLoading(null);
    }
  }

  async function handleReject() {
    if (!feedback.trim()) return;
    setLoading("reject");
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to regenerate.");
      }
      const data = await res.json() as { newDraftId?: string; capped?: boolean };
      if (data.capped) {
        setError(
          `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Edit the draft manually or start fresh.`,
        );
        setLoading(null);
        return;
      }
      router.push(`/drafts/${data.newDraftId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate.");
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <div className="space-y-6">
      {/* Editable subject + preheader */}
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <EditField
          label="Subject"
          value={subject}
          onChange={setSubject}
          singleLine
        />
        <EditField
          label="Preheader"
          value={preheader}
          onChange={setPreheader}
          singleLine
        />
      </div>

      {/* Live email preview */}
      <section>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted">
          Rendered email
        </p>
        <iframe
          key={html}
          title="Email preview"
          srcDoc={html}
          sandbox=""
          className="h-[600px] w-full rounded-lg border border-border bg-white"
        />
      </section>

      {/* HTML editor (collapsible) */}
      <div>
        <button
          onClick={() => setShowHtmlEdit((v) => !v)}
          className="text-xs text-muted hover:text-foreground"
        >
          {showHtmlEdit ? "Hide HTML editor" : "Edit HTML"}
        </button>
        {showHtmlEdit && (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={20}
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-accent focus:outline-none resize-y"
          />
        )}
      </div>

      {/* Primary actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading === "approve"
            ? "Approving…"
            : isEdited
              ? "Save & Approve"
              : "Approve"}
        </button>

        {!showReject && (
          <button
            onClick={() => setShowReject(true)}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>

      {/* Reject panel */}
      {showReject && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">
            Rejection feedback
            {atCap && (
              <span className="ml-2 text-red-400">
                · max revisions ({MAX_DRAFT_VERSIONS}) reached
              </span>
            )}
          </p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What needs to change? Be specific — this goes into the regeneration prompt."
            rows={4}
            disabled={atCap || busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none resize-none disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReject}
              disabled={busy || !feedback.trim() || atCap}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading === "reject" ? "Regenerating… (~30–90s)" : "Reject & Regenerate"}
            </button>
            <button
              onClick={() => {
                setShowReject(false);
                setFeedback("");
              }}
              disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-red-950/40 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  singleLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  singleLine?: boolean;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted">
        {label}
      </label>
      {singleLine ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none resize-none"
        />
      )}
    </div>
  );
}
