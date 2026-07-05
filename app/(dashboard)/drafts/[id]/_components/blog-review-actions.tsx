"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import type {
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  PublicationRecord,
} from "@/lib/db/types";

interface BlogReviewActionsProps {
  draftId: string;
  version: number;
  state: string;
  initialContent: EmailDraftContent; // subject = title, html = article preview
  initialMeta: DraftMeta;
  seoData: DraftSeoData;
  initialArchived: boolean;
  publication: PublicationRecord | null;
  sanityConfigured: boolean;
}

/**
 * Review surface for blog drafts. Simpler than the email one by design:
 * the article preview is read-only v1 (the Portable Text that ships to Sanity
 * is exactly what's shown), with the same approve gates (QA nudge + server
 * banned-terms block) and a publish-to-Sanity step once approved.
 */
export function BlogReviewActions({
  draftId,
  state: initialState,
  initialContent,
  initialMeta,
  seoData,
  initialArchived,
  publication: initialPublication,
  sanityConfigured,
}: BlogReviewActionsProps) {
  const router = useRouter();
  const toast = useToast();

  const [state, setState] = useState(initialState);
  const [archived, setArchived] = useState(initialArchived);
  const [archiving, setArchiving] = useState(false);
  const [metaTitle, setMetaTitle] = useState(initialMeta.meta_title ?? "");
  const [metaDesc, setMetaDesc] = useState(initialMeta.meta_description ?? "");
  const [approving, setApproving] = useState(false);
  const [showQaNudge, setShowQaNudge] = useState(false);
  const [bannedBlock, setBannedBlock] = useState<string[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState(initialPublication);

  const copy = initialMeta.blog_copy;
  const draftCostUsd = initialMeta.usage?.estimated_usd ?? 0;
  const hasQa = seoData.qa_pass !== undefined;

  function handleDownload() {
    const filename =
      (copy?.slug || "blog-post").replace(/[^\w.-]+/g, "_").slice(0, 80) + ".html";
    const blob = new Blob([initialContent.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleApproveClick() {
    if (seoData.qa_pass === false) {
      setShowQaNudge(true);
      return;
    }
    void handleApprove();
  }

  async function handleApprove(force = false) {
    setShowQaNudge(false);
    setBannedBlock(null);
    setApproving(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force,
          meta: { ...initialMeta, meta_title: metaTitle, meta_description: metaDesc },
        }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { bannedTerms?: string[] };
        setBannedBlock(data.bannedTerms ?? []);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to approve.");
      }
      setState("approved");
      toast.success("Approved. You can publish it to Sanity below.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve.");
    } finally {
      setApproving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "sanity" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        target?: string;
        externalId?: string;
        url?: string;
        alreadyPublished?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to publish.");
      setPublication({
        id: "",
        job_id: "",
        target: data.target ?? "sanity",
        external_id: data.externalId ?? null,
        url: data.url ?? null,
        published_at: "",
      });
      toast.success(
        data.alreadyPublished
          ? "Already in Sanity, nothing sent twice."
          : "Sent to Sanity as a draft document.",
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to publish.");
    } finally {
      setPublishing(false);
    }
  }

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
            <h3 className="text-[15px] font-semibold">Quality check</h3>
            <Badge tone={seoData.qa_pass ? "success" : "warning"} dot>
              {seoData.qa_pass ? "Pass" : "Issues found"}
            </Badge>
          </div>
          <div className="mt-4 space-y-3 text-[13px]">
            {(seoData.issues?.length ?? 0) > 0 && (
              <ul className="space-y-1 text-foreground/80">
                {seoData.issues!.map((issue, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-warning">·</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}
            {(seoData.banned_terms_found?.length ?? 0) > 0 && (
              <p className="text-danger">
                Words we avoided: {seoData.banned_terms_found!.join(", ")}
              </p>
            )}
            {seoData.keyword_used !== undefined && (
              <p className="text-muted">
                {seoData.keyword_used
                  ? `Search phrase: used ${seoData.keyword_placement}`
                  : "Search phrase: not placed where it counts yet"}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* SEO fields */}
      <Card className="space-y-4 p-5">
        {copy && (
          <p className="text-[13px] text-muted">
            URL slug: <span className="font-mono text-foreground/80">/{copy.slug}</span>
          </p>
        )}
        <Field label="Page title" hint="The title tag search engines show.">
          <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
        </Field>
        <Field label="Page summary" hint="The meta description under the title in search results.">
          <Textarea rows={2} value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} />
        </Field>
      </Card>

      {/* Article preview */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-[13px] font-medium text-muted">
            Article preview — exactly what publishes to Sanity
          </p>
          <button
            type="button"
            onClick={handleDownload}
            className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
          >
            Download .html
          </button>
        </div>
        <iframe
          title="Blog preview"
          srcDoc={initialContent.html}
          sandbox=""
          className="h-[720px] w-full bg-white"
        />
      </Card>

      {/* Publish (appears once approved) */}
      {state === "approved" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          {publication?.external_id ? (
            <>
              <p className="text-sm text-foreground">
                In Sanity as a draft document
                <span className="ml-2 font-mono text-[12px] text-muted">
                  {publication.external_id}
                </span>
              </p>
              {publication.url && (
                <a
                  href={publication.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-accent hover:text-accent-press"
                >
                  Open Sanity →
                </a>
              )}
            </>
          ) : sanityConfigured ? (
            <>
              <p className="text-sm text-muted">
                Publishes as a DRAFT document in your Sanity studio; you make it
                live there.
              </p>
              <Button variant="gradient" loading={publishing} onClick={handlePublish}>
                Send to Sanity
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">
              Connect Sanity to publish: set SANITY_PROJECT_ID, SANITY_DATASET,
              and SANITY_WRITE_TOKEN in .env.local (see Settings → Connections).
            </p>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {state !== "approved" && (
          <Button
            variant="gradient"
            size="lg"
            loading={approving}
            onClick={handleApproveClick}
          >
            Approve
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          loading={archiving}
          onClick={handleToggleArchive}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
        {draftCostUsd > 0 && (
          <span className="ml-auto text-[12px] text-muted">
            This draft cost about ${draftCostUsd < 0.01 ? "0.01" : draftCostUsd.toFixed(2)} to generate.
          </span>
        )}
      </div>

      <ConfirmDialog
        open={showQaNudge}
        onClose={() => setShowQaNudge(false)}
        onConfirm={() => void handleApprove()}
        title="Approve with open issues?"
        description={
          (seoData.issues?.length ?? 0) > 0
            ? `The quality check flagged ${seoData.issues!.length} thing${seoData.issues!.length === 1 ? "" : "s"} to improve. You can approve anyway.`
            : "The quality check didn't pass this draft. You can approve anyway."
        }
        confirmLabel="Approve anyway"
        cancelLabel="Keep editing"
      />
      <ConfirmDialog
        open={bannedBlock !== null}
        onClose={() => setBannedBlock(null)}
        onConfirm={() => void handleApprove(true)}
        tone="danger"
        title="This post uses words your brand avoids"
        description={
          bannedBlock?.length
            ? `Still in the post: ${bannedBlock.join(", ")}. Reject wording you don't want, or approve anyway.`
            : "You can approve anyway."
        }
        confirmLabel="Approve anyway"
        cancelLabel="Keep editing"
      />
    </div>
  );
}
