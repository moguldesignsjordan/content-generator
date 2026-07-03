"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SegmentedControl,
  Sheet,
  Textarea,
} from "@/components/ui";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type {
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  EmailTemplateId,
} from "@/lib/db/types";

interface ReviewActionsProps {
  draftId: string;
  version: number;
  initialContent: EmailDraftContent;
  initialMeta: DraftMeta;
  seoData: DraftSeoData;
}

const LAYOUT_OPTIONS: { value: EmailTemplateId | "auto"; label: string }[] = [
  { value: "auto", label: "Keep layout" },
  { value: "newsletter_tip", label: "Quick tip" },
  { value: "newsletter_feature", label: "Feature" },
  { value: "newsletter_howto", label: "Step-by-step" },
];

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
  const [layout, setLayout] = useState<EmailTemplateId | "auto">("auto");
  const [loading, setLoading] = useState<"approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Regeneration runs in the background: the reject sheet closes the instant
  // you submit, so you're never stuck watching a spinner. This page keeps a
  // "new version ready" banner for whenever the response comes back; if you
  // navigate away before then, the draft still lands, it'll just be waiting
  // for you next time you open this topic or check Emails.
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);
  const [rejectedThisDraft, setRejectedThisDraft] = useState(false);

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

  function handleReject() {
    if (!feedback.trim()) return;
    // Close the sheet and clear its state immediately, before the request
    // even resolves, so you're never trapped watching a spinner in a modal.
    // The regeneration keeps running server-side; this page just shows a
    // small non-blocking status you can ignore, watch, or navigate away from.
    const sentFeedback = feedback;
    const sentLayout = layout;
    setShowReject(false);
    setFeedback("");
    setLayout("auto");
    setRejectedThisDraft(true);
    setRegenerating(true);
    setRegenError(null);

    (async () => {
      try {
        const res = await fetch(`/api/drafts/${draftId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            feedback: sentFeedback,
            templateOverride: sentLayout === "auto" ? undefined : sentLayout,
          }),
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
          setRegenError(
            `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Edit the draft manually or start fresh.`,
          );
          return;
        }
        if (data.newDraftId) setNewDraftId(data.newDraftId);
      } catch (e) {
        setRegenError(e instanceof Error ? e.message : "Failed to regenerate.");
      } finally {
        setRegenerating(false);
      }
    })();
  }

  const busy = loading !== null || regenerating;

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

      {/* Background regeneration status: never blocks the page, closes the
          moment you submit feedback. Leave, keep reviewing, whatever, it
          finishes on its own and shows up here (or in Emails) when ready. */}
      {(regenerating || newDraftId || regenError) && (
        <Card className="flex items-center justify-between gap-3 p-4">
          {regenerating && (
            <p className="flex items-center gap-2.5 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Writing and designing the new version in the background, feel
              free to leave this page. Usually about a minute.
            </p>
          )}
          {!regenerating && newDraftId && (
            <>
              <p className="text-sm text-foreground">New version ready.</p>
              <Button
                size="sm"
                variant="gradient"
                onClick={() => router.push(`/drafts/${newDraftId}`)}
              >
                View new version
              </Button>
            </>
          )}
          {!regenerating && regenError && (
            <p className="text-sm text-danger">{regenError}</p>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="gradient"
          size="lg"
          loading={loading === "approve"}
          disabled={busy || rejectedThisDraft}
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
          disabled={busy || rejectedThisDraft || atCap}
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

      {/* Reject sheet: closes instantly on submit, regeneration continues
          in the background (see the status card above). */}
      <Sheet
        open={showReject}
        onClose={() => {
          setShowReject(false);
          setFeedback("");
          setLayout("auto");
        }}
        title="Reject & regenerate"
        description={
          atCap
            ? `Max revisions (${MAX_DRAFT_VERSIONS}) reached.`
            : `Version ${version}. Your feedback shapes the next draft, content or design.`
        }
        footer={
          <div className="flex gap-2">
            <Button
              variant="subtle"
              className="flex-1"
              onClick={() => {
                setShowReject(false);
                setFeedback("");
                setLayout("auto");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              className="flex-1"
              disabled={!feedback.trim() || atCap}
              onClick={handleReject}
            >
              Reject & regenerate
            </Button>
          </div>
        }
      >
        <Field
          label="What needs to change?"
          hint="Content or design, both work: tighten the copy, use bolder colors, more whitespace, a different tone, whatever you want different."
        >
          <Textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Lead with the pain point and tighten the CTA. Or: make it feel bolder, bigger headline, more whitespace, less text."
            disabled={atCap}
          />
        </Field>
        <Field label="Layout" hint="Leave on Keep layout unless you want a different shape.">
          <SegmentedControl
            value={layout}
            onChange={setLayout}
            options={LAYOUT_OPTIONS}
            className="w-full [&>button]:flex-1"
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
