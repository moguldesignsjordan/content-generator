"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Sheet,
  Textarea,
} from "@/components/ui";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type { DraftMeta, DraftSeoData, EmailDraftContent } from "@/lib/db/types";

interface ReviewActionsProps {
  draftId: string;
  version: number;
  initialContent: EmailDraftContent;
  initialMeta: DraftMeta;
  seoData: DraftSeoData;
}

export function ReviewActions({
  draftId,
  version,
  initialContent,
  initialMeta,
  seoData,
}: ReviewActionsProps) {
  const router = useRouter();

  const [subject, setSubject] = useState(initialContent.subject);
  const [preheader, setPreheader] = useState(initialContent.preheader);
  const [html, setHtml] = useState(initialContent.html);
  const [showHtmlEdit, setShowHtmlEdit] = useState(false);

  const [metaTitle, setMetaTitle] = useState(initialMeta.meta_title ?? "");
  const [metaDesc, setMetaDesc] = useState(initialMeta.meta_description ?? "");

  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEdited =
    subject !== initialContent.subject ||
    preheader !== initialContent.preheader ||
    html !== initialContent.html;

  const atCap = version >= MAX_DRAFT_VERSIONS;
  const hasQa = seoData.qa_pass !== undefined;
  const hasBannedTerms = (seoData.banned_terms_found?.length ?? 0) > 0;

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        meta: { meta_title: metaTitle, meta_description: metaDesc },
      };
      if (isEdited) {
        body.editedContent = { subject, preheader, html };
      }
      const res = await fetch(`/api/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to approve.");
      }
      router.push("/emails");
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to regenerate.");
      }
      const data = (await res.json()) as {
        newDraftId?: string;
        capped?: boolean;
      };
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
    <div className="space-y-5">
      {/* QA results */}
      {hasQa && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">QA results</h3>
            <Badge tone={seoData.qa_pass ? "success" : "warning"} dot>
              {seoData.qa_pass ? "Pass" : "Issues found"}
            </Badge>
          </div>

          <div className="mt-4 space-y-3 text-[13px]">
            {(seoData.issues?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-muted">Issues to address</p>
                <ul className="space-y-1 text-foreground/80">
                  {seoData.issues!.map((issue, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-warning">·</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasBannedTerms && (
              <p className="text-danger">
                Banned terms found: {seoData.banned_terms_found!.join(", ")}
              </p>
            )}

            {seoData.keyword_used !== undefined && (
              <p className="text-muted">
                {seoData.keyword_used
                  ? `Keyword used, ${seoData.keyword_placement}`
                  : "Target keyword not found in email"}
              </p>
            )}

            {seoData.readability_note && (
              <p className="text-muted">{seoData.readability_note}</p>
            )}
          </div>

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="text-[13px] font-medium text-foreground">SEO meta</p>
            <Field label="Meta title (≤60 chars)">
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
            </Field>
            <Field label="Meta description (≤155 chars)">
              <Textarea
                rows={2}
                value={metaDesc}
                onChange={(e) => setMetaDesc(e.target.value)}
              />
            </Field>
          </div>
        </Card>
      )}

      {/* Editable copy */}
      <Card className="space-y-4 p-5">
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Preheader">
          <Input
            value={preheader}
            onChange={(e) => setPreheader(e.target.value)}
          />
        </Field>
      </Card>

      {/* Live preview */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-[13px] font-medium text-muted">Rendered email</p>
          <button
            type="button"
            onClick={() => setShowHtmlEdit((v) => !v)}
            className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
          >
            {showHtmlEdit ? "Hide HTML" : "Edit HTML"}
          </button>
        </div>
        <iframe
          key={html}
          title="Email preview"
          srcDoc={html}
          sandbox=""
          className="h-[600px] w-full bg-white"
        />
        {showHtmlEdit && (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full resize-y border-t border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
          />
        )}
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="gradient"
          size="lg"
          loading={loading === "approve"}
          disabled={busy}
          onClick={handleApprove}
        >
          {loading === "approve"
            ? "Approving…"
            : isEdited
              ? "Save & approve"
              : "Approve"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={busy}
          onClick={() => setShowReject(true)}
        >
          Reject
        </Button>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Reject sheet */}
      <Sheet
        open={showReject}
        onClose={() => {
          setShowReject(false);
          setFeedback("");
        }}
        title="Reject & regenerate"
        description={
          atCap
            ? `Max revisions (${MAX_DRAFT_VERSIONS}) reached.`
            : `Version ${version}. Your feedback shapes the next draft.`
        }
        footer={
          <div className="flex gap-2">
            <Button
              variant="subtle"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setShowReject(false);
                setFeedback("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              className="flex-1"
              loading={loading === "reject"}
              disabled={busy || !feedback.trim() || atCap}
              onClick={handleReject}
            >
              {loading === "reject" ? "Regenerating…" : "Reject & regenerate"}
            </Button>
          </div>
        }
      >
        <Field
          label="What needs to change?"
          hint="Be specific, this goes into the regeneration prompt."
        >
          <Textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Lead with the pain point, tighten the CTA, drop the second section."
            disabled={atCap || busy}
          />
        </Field>
        {atCap && (
          <p className="mt-3 text-sm text-danger">
            Max revisions reached. Edit the draft manually or start fresh.
          </p>
        )}
      </Sheet>
    </div>
  );
}
