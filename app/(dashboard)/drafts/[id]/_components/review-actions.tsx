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
  Tooltip,
  useToast,
} from "@/components/ui";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type { DraftMeta, DraftSeoData, EmailDraftContent } from "@/lib/db/types";
import { DesignChat } from "./design-chat";
import { EmailPreview } from "./email-preview";

interface ReviewActionsProps {
  draftId: string;
  version: number;
  initialContent: EmailDraftContent;
  initialMeta: DraftMeta;
  seoData: DraftSeoData;
  initialArchived: boolean;
}

/**
 * Swaps the href on the CTA button (the <a> inside the data-region="cta"
 * wrapper every template and model-designed email tags) so editing the CTA
 * link field updates the rendered button instantly, no model call needed.
 */
function applyCtaHref(html: string, url: string): string {
  const href = url.trim() || "#";
  return html.replace(
    /(data-region="cta"[\s\S]*?<a\s[^>]*\bhref=")[^"]*(")/,
    `$1${href}$2`,
  );
}

export function ReviewActions({
  draftId,
  version,
  initialContent,
  initialMeta,
  seoData,
  initialArchived,
}: ReviewActionsProps) {
  const router = useRouter();
  const [archived, setArchived] = useState(initialArchived);
  const [archiving, setArchiving] = useState(false);

  const [subject, setSubject] = useState(initialContent.subject);
  const [preheader, setPreheader] = useState(initialContent.preheader);
  const [html, setHtml] = useState(initialContent.html);
  const initialCtaUrl = initialMeta.email_copy?.cta_url ?? "";
  const [ctaUrl, setCtaUrl] = useState(initialCtaUrl);

  function handleCtaChange(value: string) {
    setCtaUrl(value);
    setHtml((h) => applyCtaHref(h, value));
  }

  function handleDownload() {
    const filename =
      (subject.trim() || "email").replace(/[^\w.-]+/g, "_").slice(0, 80) + ".html";
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [metaTitle, setMetaTitle] = useState(initialMeta.meta_title ?? "");
  const [metaDesc, setMetaDesc] = useState(initialMeta.meta_description ?? "");

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState<"approve" | null>(null);
  const toast = useToast();

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
    try {
      const body: Record<string, unknown> = {
        meta: {
          ...initialMeta,
          meta_title: metaTitle,
          meta_description: metaDesc,
          ...(initialMeta.email_copy && {
            email_copy: { ...initialMeta.email_copy, cta_url: ctaUrl.trim() || undefined },
          }),
        },
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
      toast.success("Approved.");
      router.push("/emails");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve.");
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
    setShowReject(false);
    setFeedback("");
    setRejectedThisDraft(true);
    setRegenerating(true);
    setRegenError(null);

    (async () => {
      try {
        const res = await fetch(`/api/drafts/${draftId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: sentFeedback }),
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

  async function handleToggleArchive() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/archive`, {
        method: archived ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error();
      setArchived(!archived);
      toast.success(archived ? "Unarchived." : "Archived.");
      router.refresh();
    } catch {
      toast.error(`Failed to ${archived ? "unarchive" : "archive"}.`);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Quality check */}
      {hasQa && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[15px] font-semibold">Quality check</h3>
              <Tooltip
                label="Automatic checks for tone, structure, and search visibility, run on every draft."
                side="right"
              >
                <button
                  type="button"
                  aria-label="What's this?"
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-muted hover:text-foreground"
                >
                  ⓘ
                </button>
              </Tooltip>
            </div>
            <Badge tone={seoData.qa_pass ? "success" : "warning"} dot>
              {seoData.qa_pass ? "Pass" : "Issues found"}
            </Badge>
          </div>

          <div className="mt-4 space-y-3 text-[13px]">
            {(seoData.issues?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-muted">Things to improve</p>
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
                Words we avoided: {seoData.banned_terms_found!.join(", ")}
              </p>
            )}

            {seoData.keyword_used !== undefined && (
              <p className="text-muted">
                {seoData.keyword_used
                  ? `Search phrase: used, ${seoData.keyword_placement}`
                  : "Search phrase: not used yet"}
              </p>
            )}

            {seoData.readability_note && (
              <p className="text-muted">{seoData.readability_note}</p>
            )}
          </div>

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="text-[13px] font-medium text-foreground">Web version details</p>
            <p className="text-xs text-muted">
              These show up if this content is also published as a blog post,
              not in the email itself.
            </p>
            <Field label="Page title">
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
            </Field>
            <Field label="Page summary">
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
        <Field label="CTA link" hint="Where the button in this email points.">
          <Input
            type="url"
            value={ctaUrl}
            onChange={(e) => handleCtaChange(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </Card>

      {/* Live preview */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-[13px] font-medium text-muted">
            Rendered email — click any part to tweak it
          </p>
          <button
            type="button"
            onClick={handleDownload}
            className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
          >
            Download .html
          </button>
        </div>
        <EmailPreview
          draftId={draftId}
          html={html}
          onHtmlChange={setHtml}
          onEdited={() => setHistoryRefreshKey((k) => k + 1)}
        />
      </Card>

      <DesignChat
        key={historyRefreshKey}
        draftId={draftId}
        html={html}
        onHtmlChange={setHtml}
      />

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
        <Button
          variant="ghost"
          size="lg"
          loading={archiving}
          disabled={busy}
          onClick={handleToggleArchive}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
        {archived && (
          <span className="text-[13px] text-muted">
            Hidden from the Emails list.
          </span>
        )}
      </div>

      {/* Reject sheet: closes instantly on submit, regeneration continues
          in the background (see the status card above). */}
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
        {atCap && (
          <p className="mt-3 text-sm text-danger">
            Max revisions reached. Edit the draft manually or start fresh.
          </p>
        )}
      </Sheet>
    </div>
  );
}
