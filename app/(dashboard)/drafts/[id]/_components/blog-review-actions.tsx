"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AccentSpinner,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  LinkButton,
  Sheet,
  Textarea,
  Tooltip,
  useToast,
} from "@/components/ui";
import { ApiError, type ApiErrorBody, toastApiError } from "@/lib/billing/toast-error";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type {
  BlogCopy,
  ContentImage,
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  PublicationRecord,
} from "@/lib/db/types";
import { ImageSheet } from "./image-sheet";
import { BlogPreview } from "./blog-preview";

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
 * Review surface for blog drafts. Simpler than the email one by design: the
 * article body is edited as structured fields (title, slug, intro, each
 * section, conclusion, CTA) rather than click-to-edit HTML regions, since
 * blog HTML is code-rendered from meta.blog_copy, not model-authored markup.
 * Edits save via PATCH /blog-copy, which re-renders the preview from the
 * updated copy so the iframe below always shows exactly what would publish
 * to Sanity. Same approve gates as email (QA nudge + server banned-terms
 * block) and a publish-to-Sanity step once approved. The hero image is
 * edited separately (generate or upload; publishes as the post's main image).
 */
export function BlogReviewActions({
  draftId,
  version,
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
  const [html, setHtml] = useState(initialContent.html);
  const [heroImage, setHeroImage] = useState<ContentImage | null>(
    initialMeta.hero_image ?? null,
  );
  const [imageOpen, setImageOpen] = useState(false);
  const [regeneratingImage, setRegeneratingImage] = useState(false);
  const [archived, setArchived] = useState(initialArchived);
  const [archiving, setArchiving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copy, setCopy] = useState<BlogCopy | null>(initialMeta.blog_copy ?? null);
  const [seoOpen, setSeoOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState(initialMeta.blog_copy?.meta_title ?? "");
  const [metaDescription, setMetaDescription] = useState(
    initialMeta.blog_copy?.meta_description ?? "",
  );
  const [savingSeo, setSavingSeo] = useState(false);
  const [seoError, setSeoError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [showQaNudge, setShowQaNudge] = useState(false);
  const [bannedBlock, setBannedBlock] = useState<string[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState(initialPublication);

  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenUpgradeUrl, setRegenUpgradeUrl] = useState<string | null>(null);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);
  const [rejectedThisDraft, setRejectedThisDraft] = useState(false);

  const draftCostUsd = initialMeta.usage?.estimated_usd ?? 0;
  const hasQa = seoData.qa_pass !== undefined;
  const atCap = version >= MAX_DRAFT_VERSIONS;
  const isActionable = state === "in_review";
  const busy = approving || archiving || publishing || regenerating || savingSeo;
  const rejectDisabledReason = atCap
    ? `Max revisions (${MAX_DRAFT_VERSIONS}) reached.`
    : rejectedThisDraft
      ? "Already rejected. Check for the new version above."
      : null;

  function handleReject() {
    if (!feedback.trim()) return;
    const sentFeedback = feedback;
    setShowReject(false);
    setFeedback("");
    setRejectedThisDraft(true);
    setRegenerating(true);
    setRegenError(null);
    setRegenUpgradeUrl(null);

    (async () => {
      try {
        const res = await fetch(`/api/drafts/${draftId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: sentFeedback }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
          throw new ApiError(data.error ?? "Failed to regenerate.", data);
        }
        const data = (await res.json()) as {
          newDraftId?: string;
          capped?: boolean;
          notInReview?: boolean;
        };
        if (data.notInReview) {
          setRegenError("This draft is no longer awaiting review, so it can't be rejected.");
          router.refresh();
          return;
        }
        if (data.capped) {
          setRegenError(
            `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Start a fresh post instead.`,
          );
          return;
        }
        if (data.newDraftId) setNewDraftId(data.newDraftId);
      } catch (e) {
        setRegenError(e instanceof Error ? e.message : "Failed to regenerate.");
        if (e instanceof ApiError && e.outOfCredits) {
          setRegenUpgradeUrl(e.upgradeUrl ?? "/billing");
        }
      } finally {
        setRegenerating(false);
      }
    })();
  }

  function handleDownload() {
    const filename =
      (copy?.slug || "blog-post").replace(/[^\w.-]+/g, "_").slice(0, 80) + ".html";
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** One-tap re-roll: same style, a fresh AI-crafted take. The full
   * ImageSheet still covers style changes, subject, and exact-prompt. */
  async function regenerateImage() {
    if (regeneratingImage || !heroImage || heroImage.style === "uploaded") return;
    setRegeneratingImage(true);
    try {
      const form = new FormData();
      form.set("mode", "generate");
      form.set("style", heroImage.style);
      const res = await fetch(`/api/drafts/${draftId}/image`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as ApiErrorBody & {
        html?: string;
        image?: ContentImage;
      };
      if (!res.ok || !data.html) {
        throw new ApiError(data.error ?? "Couldn't regenerate the image.", data);
      }
      setHtml(data.html);
      setHeroImage(data.image ?? null);
    } catch (err) {
      toastApiError(toast, err instanceof ApiError ? err : null, "Couldn't regenerate the image.");
    } finally {
      setRegeneratingImage(false);
    }
  }

  function openSeo() {
    setMetaTitle(copy?.meta_title ?? "");
    setMetaDescription(copy?.meta_description ?? "");
    setSeoError(null);
    setSeoOpen(true);
  }

  async function handleSaveSeo() {
    if (!copy) return;
    setSavingSeo(true);
    setSeoError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/blog-copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...copy,
          meta_title: metaTitle,
          meta_description: metaDescription,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        html?: string;
        copy?: BlogCopy;
        error?: string;
      };
      if (!res.ok || !data.html || !data.copy) {
        throw new Error(data.error ?? "Couldn't save your edits.");
      }
      setHtml(data.html);
      setCopy(data.copy);
      setSeoOpen(false);
      toast.success("SEO details saved.");
    } catch (e) {
      setSeoError(e instanceof Error ? e.message : "Couldn't save your edits.");
    } finally {
      setSavingSeo(false);
    }
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
          meta: {
            ...initialMeta,
            meta_title: copy?.meta_title ?? initialMeta.meta_title,
            meta_description: copy?.meta_description ?? initialMeta.meta_description,
          },
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
        status: "sent",
        scheduled_for: null,
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

  // Permanently removes the draft. Published drafts (already sent to Sanity)
  // are blocked server-side (409); those should be archived instead.
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ??
            "This post was published, so it can't be deleted. Archive it instead.",
        );
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete.");
      }
      toast.success("Draft deleted.");
      router.push("/blogs");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
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

      {/* SEO details: page title / meta description. Edited separately from
          the article body since search-facing meta isn't part of the
          rendered preview. */}
      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">SEO details</h3>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">
            {copy?.meta_title || "No page title set."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openSeo} disabled={!copy}>
          Edit SEO details
        </Button>
      </Card>

      {/* Article preview: click any highlighted part of the article to edit
          it in place. This is exactly what publishes to Sanity. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="min-w-0 truncate text-[13px] font-medium text-muted">
            Click a section to select it, double-click to type on it
          </p>
          <div className="flex shrink-0 items-center gap-3">
            {heroImage && heroImage.style !== "uploaded" && (
              <button
                type="button"
                onClick={regenerateImage}
                disabled={regeneratingImage}
                className="flex items-center gap-1.5 text-[12px] font-medium text-accent transition-colors hover:text-accent-press disabled:opacity-60"
              >
                {regeneratingImage && <AccentSpinner size={12} />} Regenerate
              </button>
            )}
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              disabled={regeneratingImage}
              className="text-[12px] font-medium text-accent transition-colors hover:text-accent-press disabled:opacity-60"
            >
              {heroImage ? "Edit image" : "+ Add image"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
            >
              Download .html
            </button>
          </div>
        </div>
        <BlogPreview
          draftId={draftId}
          copy={copy}
          html={html}
          onSaved={(newHtml, newCopy) => {
            setHtml(newHtml);
            setCopy(newCopy);
          }}
        />
      </Card>

      {/* Hero image tool: generate or upload; publishes to Sanity as the
          post's main image. */}
      <ImageSheet
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        draftId={draftId}
        kind="blog"
        hasImage={!!heroImage}
        promptUsed={heroImage?.prompt}
        onApplied={(newHtml, newImage) => {
          setHtml(newHtml);
          setHeroImage(newImage);
        }}
      />

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

      {/* Background regeneration status: never blocks the page, closes the
          moment you submit feedback. Mirrors the email review screen. */}
      {(regenerating || newDraftId || regenError) && (
        <Card className="flex items-center justify-between gap-3 p-4">
          {regenerating && (
            <p className="flex items-center gap-2.5 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Writing the new version in the background, feel free to leave
              this page. Usually about a minute.
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
            <>
              <p className="text-sm text-danger">{regenError}</p>
              {regenUpgradeUrl && (
                <LinkButton href={regenUpgradeUrl} variant="gradient" size="sm">
                  Buy credits
                </LinkButton>
              )}
            </>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {isActionable ? (
          <>
            <Button
              variant="gradient"
              size="lg"
              loading={approving}
              disabled={busy || rejectedThisDraft}
              onClick={handleApproveClick}
            >
              Approve
            </Button>
            {rejectDisabledReason ? (
              <Tooltip label={rejectDisabledReason} side="top">
                <Button variant="outline" size="lg" disabled>
                  Reject
                </Button>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowReject(true)}
              >
                Reject
              </Button>
            )}
          </>
        ) : (
          <p className="text-[13px] text-muted">
            {state === "approved"
              ? "This draft has already been approved."
              : state === "rejected"
                ? "This draft was rejected. Check for a newer version of this post."
                : "This is no longer the active version of this draft."}
          </p>
        )}
        <Button
          variant="ghost"
          size="lg"
          loading={archiving}
          disabled={busy}
          onClick={handleToggleArchive}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="text-danger hover:bg-danger/10"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
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
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this draft permanently?"
        description="This removes the draft and its edit history. It can't be undone. If you might still want it, archive it instead."
        confirmLabel="Delete"
        loading={deleting}
      />

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
            : `Version ${version}. Your feedback shapes the next draft.`
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
          hint="Tighten the copy, cover a different angle, adjust the depth or tone, whatever you want different."
        >
          <Textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Go deeper on the pricing section and cut the intro in half."
            disabled={atCap}
          />
        </Field>
        {atCap && (
          <p className="mt-3 text-sm text-danger">
            Max revisions reached. Start a fresh post instead.
          </p>
        )}
      </Sheet>

      {/* SEO details sheet: page title / meta description only, separate
          from the click-to-edit article fields above. */}
      <Sheet
        open={seoOpen}
        onClose={() => setSeoOpen(false)}
        title="SEO details"
        description="The title and summary search engines show. Separate from the headline shown on the page."
        footer={
          <div className="flex gap-2">
            <Button variant="subtle" className="flex-1" onClick={() => setSeoOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={savingSeo}
              onClick={handleSaveSeo}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Page title" hint="The title tag search engines show.">
            <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
          </Field>
          <Field
            label="Page summary"
            hint="The meta description under the title in search results."
          >
            <Textarea
              rows={3}
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
            />
          </Field>
          {seoError && <p className="text-sm text-danger">{seoError}</p>}
        </div>
      </Sheet>
    </div>
  );
}
