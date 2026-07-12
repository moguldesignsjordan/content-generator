"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Sheet,
  Textarea,
  Tooltip,
  useToast,
} from "@/components/ui";
import { DownloadIcon } from "@/components/ui/icons";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type { DraftMeta, FlyerAspect } from "@/lib/db/types";
import { FlyerSheet } from "./flyer-sheet";

interface FlyerReviewActionsProps {
  draftId: string;
  version: number;
  state: string;
  initialMeta: DraftMeta;
  initialArchived: boolean;
}

// Preview box aspect classes, keyed by meta.flyer_aspect. Static strings so
// Tailwind sees them at build time.
const ASPECT_CLASS: Record<FlyerAspect, string> = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
};

/**
 * Review surface for social flyer drafts (content_jobs.type='social'). v1
 * "publish" is approve + download: the approve gate is the same server-side
 * check every draft kind uses, and the Download button only unlocks after it.
 * Rejecting regenerates a new version in the background (copy AND image, since
 * a flyer's copy is baked into its image), like the blog review screen.
 */
export function FlyerReviewActions({
  draftId,
  version,
  state: initialState,
  initialMeta,
  initialArchived,
}: FlyerReviewActionsProps) {
  const router = useRouter();
  const toast = useToast();

  const [state, setState] = useState(initialState);
  const [archived, setArchived] = useState(initialArchived);
  const [archiving, setArchiving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);

  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);
  const [rejectedThisDraft, setRejectedThisDraft] = useState(false);

  const [image, setImage] = useState(initialMeta.flyer_image ?? null);
  const [copy, setCopy] = useState(initialMeta.flyer_copy ?? null);
  const [aspect, setAspect] = useState<FlyerAspect>(
    initialMeta.flyer_aspect ?? "1:1",
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [hashtagsDraft, setHashtagsDraft] = useState("");
  const [savingCaption, setSavingCaption] = useState(false);

  const caption = [copy?.caption, copy?.hashtags?.join(" ")]
    .filter(Boolean)
    .join("\n\n");

  const draftCostUsd = initialMeta.usage?.estimated_usd ?? 0;
  const atCap = version >= MAX_DRAFT_VERSIONS;
  const isActionable = state === "in_review";
  const isApproved = state === "approved";
  const busy = approving || archiving || regenerating;
  const rejectDisabledReason = atCap
    ? `Max revisions (${MAX_DRAFT_VERSIONS}) reached.`
    : rejectedThisDraft
      ? "Already rejected. Check for the new version above."
      : null;

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to approve.");
      }
      setState("approved");
      toast.success("Approved. Download the flyer below and post it.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve.");
    } finally {
      setApproving(false);
    }
  }

  function handleReject() {
    if (!feedback.trim()) return;
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
          notInReview?: boolean;
        };
        if (data.notInReview) {
          setRegenError(
            "This draft is no longer awaiting review, so it can't be rejected.",
          );
          router.refresh();
          return;
        }
        if (data.capped) {
          setRegenError(
            `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Start a fresh flyer instead.`,
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

  async function handleSaveCaption() {
    if (!captionDraft.trim() || savingCaption) return;
    setSavingCaption(true);
    try {
      const form = new FormData();
      form.set("mode", "caption");
      form.set("caption", captionDraft.trim());
      form.set("hashtags", hashtagsDraft);
      const res = await fetch(`/api/drafts/${draftId}/flyer`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        copy?: NonNullable<DraftMeta["flyer_copy"]>;
        error?: string;
      };
      if (!res.ok || !data.copy) throw new Error(data.error ?? "Failed to save.");
      setCopy(data.copy);
      setCaptionOpen(false);
      toast.success("Caption saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingCaption(false);
    }
  }

  async function handleCopyCaption() {
    if (!caption) return;
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption copied.");
    } catch {
      toast.error("Couldn't copy the caption.");
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

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete.");
      }
      toast.success("Draft deleted.");
      router.push("/flyers");
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
      {/* The flyer, at its real post shape. */}
      <Card className="p-5">
        {isActionable && (
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="text-[12px] font-medium text-accent transition-colors hover:text-accent-press"
            >
              Edit design
            </button>
          </div>
        )}
        <div className="mx-auto w-full max-w-[420px]">
          {image?.url ? (
            <div
              className={`${ASPECT_CLASS[aspect]} w-full overflow-hidden rounded-xl border border-border bg-surface-2`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.alt}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div
              className={`${ASPECT_CLASS[aspect]} flex w-full items-center justify-center rounded-xl border border-border bg-surface-2`}
            >
              <p className="px-6 text-center text-sm text-muted">
                No image on this draft. Reject it with feedback to generate a
                new version.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Post caption: what gets pasted next to the image on FB/IG. */}
      {copy && (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Post caption</h3>
            <div className="flex items-center gap-2">
              {isActionable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCaptionDraft(copy?.caption ?? "");
                    setHashtagsDraft(copy?.hashtags?.join(" ") ?? "");
                    setCaptionOpen(true);
                  }}
                >
                  Edit
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleCopyCaption}>
                Copy caption
              </Button>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">
            {copy.caption}
          </p>
          {(copy.hashtags?.length ?? 0) > 0 && (
            <p className="mt-2 text-[13px] text-accent">
              {copy.hashtags!.join(" ")}
            </p>
          )}
        </Card>
      )}

      {/* Download (v1 "publish"): unlocks after approval. */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        {isApproved ? (
          <>
            <p className="text-sm text-muted">
              Approved. Download the flyer and post it with the caption above.
            </p>
            <a href={`/api/drafts/${draftId}/flyer/download`} download>
              <Button variant="gradient">
                <DownloadIcon size={16} /> Download flyer
              </Button>
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Approve the flyer to unlock the download.
            </p>
            <Tooltip label="Approve this flyer first." side="top">
              <Button variant="outline" disabled>
                <DownloadIcon size={16} /> Download flyer
              </Button>
            </Tooltip>
          </>
        )}
      </Card>

      {/* Background regeneration status, mirroring the blog review screen. */}
      {(regenerating || newDraftId || regenError) && (
        <Card className="flex items-center justify-between gap-3 p-4">
          {regenerating && (
            <p className="flex items-center gap-2.5 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Designing the new version in the background, feel free to leave
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
            <p className="text-sm text-danger">{regenError}</p>
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
              onClick={() => void handleApprove()}
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
              <Button variant="outline" size="lg" onClick={() => setShowReject(true)}>
                Reject
              </Button>
            )}
          </>
        ) : (
          <p className="text-[13px] text-muted">
            {state === "approved"
              ? "This flyer has been approved."
              : state === "rejected"
                ? "This flyer was rejected. Check for a newer version."
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
            This flyer cost about $
            {draftCostUsd < 0.01 ? "0.01" : draftCostUsd.toFixed(2)} to generate.
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this flyer permanently?"
        description="This removes the draft and its history. It can't be undone. If you might still want it, archive it instead."
        confirmLabel="Delete"
        loading={deleting}
      />

      {/* Reject sheet: closes instantly on submit, regeneration continues in
          the background (see the status card above). */}
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
            : `Version ${version}. Your feedback shapes the next flyer.`
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
          hint="A different headline, imagery, layout feel, or offer, whatever you want different. Copy and design both regenerate."
        >
          <Textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Lead with the discount, and make it feel more premium and less busy."
            disabled={atCap}
          />
        </Field>
        {atCap && (
          <p className="mt-3 text-sm text-danger">
            Max revisions reached. Start a fresh flyer instead.
          </p>
        )}
      </Sheet>

      {/* Design edits: text/shape/style re-render, exact prompt, or upload. */}
      <FlyerSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        draftId={draftId}
        copy={copy}
        aspect={aspect}
        promptUsed={image?.prompt}
        styleReferenceId={initialMeta.style_reference_id}
        onApplied={(newImage, newCopy, newAspect) => {
          setImage(newImage);
          setCopy(newCopy);
          setAspect(newAspect);
          router.refresh();
        }}
      />

      {/* Caption edit: plain text, no AI, instant. */}
      <Sheet
        open={captionOpen}
        onClose={() => setCaptionOpen(false)}
        title="Edit caption"
        description="The text you paste next to the image when posting."
        footer={
          <div className="flex gap-2">
            <Button
              variant="subtle"
              className="flex-1"
              onClick={() => setCaptionOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={savingCaption}
              disabled={!captionDraft.trim()}
              onClick={() => void handleSaveCaption()}
            >
              Save caption
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Caption">
            <Textarea
              rows={5}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
            />
          </Field>
          <Field label="Hashtags" hint="Separate with spaces; # is added if missing.">
            <Input
              value={hashtagsDraft}
              onChange={(e) => setHashtagsDraft(e.target.value)}
              placeholder="#webdesign #smallbusiness"
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
