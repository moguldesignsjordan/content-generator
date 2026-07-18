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
  LinkButton,
  SegmentedControl,
  Sheet,
  Textarea,
  Tooltip,
  useToast,
} from "@/components/ui";
import { ApiError, type ApiErrorBody, toastApiError } from "@/lib/billing/toast-error";
import { MAX_DRAFT_VERSIONS } from "@/lib/pipeline/constants";
import type {
  DraftFeedback,
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  EmailStyleId,
  EmailTemplateId,
  PerformanceMetric,
  PublicationRecord,
} from "@/lib/db/types";
import {
  forceColorScheme,
  hasDarkModeSupport,
  type EmailPreviewMode,
} from "@/lib/email/preview-mode";
import { locateRegion } from "@/lib/email/inline-style";
import { ThumbsDownIcon, ThumbsUpIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { DesignChat } from "./design-chat";
import { EmailPreview } from "./email-preview";
import { PerformanceStats } from "./performance-stats";

// Human labels for the design direction badge below. Kept local (not
// imported from prompts/email-styles.ts or lib/email/templates, both of
// which pull in "server-only" code) so this client component's bundle
// never touches server-only modules. Light touch: display only, no picker.
const STYLE_LABELS: Record<EmailStyleId, string> = {
  soft_card: "Soft card",
  editorial_serif: "Editorial serif",
  bold_accent_band: "Bold accent band",
  minimal_mono: "Minimal mono",
  bordered_ledger: "Bordered ledger",
  left_rule_editorial: "Left rule editorial",
  pill_modern: "Pill modern",
  warm_gradient_top: "Warm gradient top",
};

const LAYOUT_LABELS: Record<EmailTemplateId, string> = {
  newsletter_tip: "Quick tip",
  newsletter_feature: "Feature",
  newsletter_howto: "How-to",
  promotional_bold: "Promotional",
  announcement_banner: "Announcement",
  product_spotlight: "Product spotlight",
  digest: "Digest",
};

interface ReviewActionsProps {
  draftId: string;
  version: number;
  /** "in_review" | "approved" | "rejected" | "superseded". Only "in_review" can still be approved or rejected. */
  state: string;
  initialContent: EmailDraftContent;
  initialMeta: DraftMeta;
  seoData: DraftSeoData;
  initialArchived: boolean;
  /** A blog already spun off this email, if any. When present, the blog card
   * links to it instead of offering to create a duplicate. */
  existingBlog?: { draftId: string; subject: string } | null;
  /** A flyer already spun off this email, if any. Same link-not-duplicate rule. */
  existingFlyer?: { draftId: string; subject: string } | null;
  /** The MailerLite campaign row if this email was already pushed, else null. */
  publication: PublicationRecord | null;
  /** True when MailerLite has an API key + sender identity and can actually send. */
  mailerliteConfigured: boolean;
  /** Last-fetched MailerLite performance snapshot, if any (Plan 2). */
  initialPerformance?: PerformanceMetric[];
  /** The reviewer's saved thumbs rating on this draft, if any. */
  initialFeedback?: DraftFeedback | null;
}

/**
 * Swaps the href on the CTA button (the <a> inside the data-region="cta"
 * wrapper every template and model-designed email tags) so editing the CTA
 * link field updates the rendered button, no model call needed.
 *
 * Scoped to the CTA region's own markup. The previous version matched
 * `data-region="cta"[\s\S]*?<a ... href="` across the whole document, and that
 * `[\s\S]*?` was unbounded: when the CTA region contained no anchor, the match
 * ran straight past it and rewrote the first <a href> further down the
 * email — in practice the unsubscribe link in the footer. Locating the region
 * first means the replacement physically cannot leave it, and an anchorless CTA
 * now leaves the document alone instead of corrupting it.
 */
function applyCtaHref(html: string, url: string): string {
  const href = url.trim() || "#";
  const located = locateRegion(html, "cta", 0);
  if (!located) return html;

  const anchorHref = /(<a\s[^>]*\bhref=")[^"]*(")/i;
  if (!anchorHref.test(located.outerHTML)) return html;

  const next = located.outerHTML.replace(anchorHref, `$1${href}$2`);
  return html.slice(0, located.start) + next + html.slice(located.end);
}

export function ReviewActions({
  draftId,
  version,
  state,
  initialContent,
  initialMeta,
  seoData,
  initialArchived,
  existingBlog,
  existingFlyer,
  publication: initialPublication,
  mailerliteConfigured,
  initialPerformance = [],
  initialFeedback = null,
}: ReviewActionsProps) {
  const router = useRouter();
  const [archived, setArchived] = useState(initialArchived);
  const [archiving, setArchiving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingBlog, setCreatingBlog] = useState(false);
  const [creatingFlyer, setCreatingFlyer] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState(initialPublication);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState("");

  const [subject, setSubject] = useState(initialContent.subject);
  const [preheader, setPreheader] = useState(initialContent.preheader);
  const [html, setHtml] = useState(initialContent.html);
  const initialCtaUrl = initialMeta.email_copy?.cta_url ?? "";
  const [ctaUrl, setCtaUrl] = useState(initialCtaUrl);
  // Open locked to LIGHT, not "auto": most subscribers read email in light
  // mode, and reviewers on a dark system kept seeing (and judging) the dark
  // variant first. Falls back to "auto" for drafts with no dark CSS to force.
  const [previewMode, setPreviewMode] = useState<EmailPreviewMode>(() =>
    hasDarkModeSupport(initialContent.html) ? "light" : "auto",
  );
  // Older drafts, and any model-authored draft that skipped the dark-mode CSS
  // the prompt asks for, have nothing for the toggle to force — disable
  // Light/Dark rather than let them silently do nothing.
  const darkSupported = hasDarkModeSupport(html);

  /**
   * Rewrites the button's href once the field is done being typed in, rather
   * than on every keystroke: each keystroke used to run a document-wide regex
   * over the email and mutate the html state, so a half-typed URL was being
   * spliced in dozens of times per edit.
   */
  function commitCtaHref() {
    setHtml((h) => applyCtaHref(h, ctaUrl));
  }

  function handleDownload() {
    const suffix = previewMode === "auto" ? "" : `_${previewMode}`;
    const filename =
      (subject.trim() || "email").replace(/[^\w.-]+/g, "_").slice(0, 80) + suffix + ".html";
    const blob = new Blob([forceColorScheme(html, previewMode)], { type: "text/html" });
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

  // Thumbs rating: judgment-only, never changes the draft's state. Ratings
  // feed the generator's liked/disliked examples, so every tap teaches it.
  // Optimistic with rollback; tapping the active thumb clears it.
  const [thumbs, setThumbs] = useState<DraftFeedback | null>(initialFeedback);
  const [savingThumbs, setSavingThumbs] = useState(false);
  // A fresh thumbs-down opens a quick "why" sheet: chips + optional free
  // text, feeding the WHY into future generations, not just the "avoid this".
  const [showDownReason, setShowDownReason] = useState(false);
  const [downReason, setDownReason] = useState("");

  async function rateDraft(next: DraftFeedback, note?: string | null) {
    if (savingThumbs) return;
    const value = thumbs === next ? null : next;
    const prev = thumbs;
    setThumbs(value);
    setSavingThumbs(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: value, note: value ? (note ?? null) : null }),
      });
      if (!res.ok) throw new Error();
      if (value === "up") toast.success("Noted. More emails like this one.");
      else if (value === "down") toast.success("Noted. Future emails will steer away from this.");
    } catch {
      setThumbs(prev);
      toast.error("Could not save your rating. Try again.");
    } finally {
      setSavingThumbs(false);
    }
  }

  const DOWN_REASONS = ["Too stiff", "Too long", "Too generic", "Wrong vibe"];

  function submitDownReason() {
    const note = downReason.trim();
    setShowDownReason(false);
    setDownReason("");
    void rateDraft("down", note || null);
  }

  // Regeneration runs in the background: the reject sheet closes the instant
  // you submit, so you're never stuck watching a spinner. This page keeps a
  // "new version ready" banner for whenever the response comes back; if you
  // navigate away before then, the draft still lands, it'll just be waiting
  // for you next time you open this topic or check Emails.
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenUpgradeUrl, setRegenUpgradeUrl] = useState<string | null>(null);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);
  const [rejectedThisDraft, setRejectedThisDraft] = useState(false);

  const isEdited =
    subject !== initialContent.subject ||
    preheader !== initialContent.preheader ||
    html !== initialContent.html;

  const atCap = version >= MAX_DRAFT_VERSIONS;
  // Only the active in-review draft can still be approved or rejected.
  // Approved/rejected/superseded versions are historical.
  const isActionable = state === "in_review";
  const hasQa = seoData.qa_pass !== undefined;
  const hasBannedTerms = (seoData.banned_terms_found?.length ?? 0) > 0;
  const hasUnsupportedSpecifics = (seoData.unsupported_specifics?.length ?? 0) > 0;

  const subjectVariants = initialMeta.email_copy?.subject_variants ?? [];
  const draftCostUsd = initialMeta.usage?.estimated_usd ?? 0;
  const designLabel = [
    initialMeta.email_style_variant ? STYLE_LABELS[initialMeta.email_style_variant] : null,
    initialMeta.email_template_id ? LAYOUT_LABELS[initialMeta.email_template_id] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Approve runs through two soft gates: a nudge when the quality check found
  // issues, and a server-enforced banned-terms block (409) that needs an
  // explicit override to pass. Neither ever auto-edits the copy.
  const [showQaNudge, setShowQaNudge] = useState(false);
  const [bannedBlock, setBannedBlock] = useState<string[] | null>(null);

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
    setLoading("approve");
    try {
      const body: Record<string, unknown> = {
        force,
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
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          bannedTerms?: string[];
          notInReview?: boolean;
        };
        if (data.notInReview) {
          // Not a soft nudge like banned terms: there's nothing to "approve
          // anyway" once the draft is no longer the active review target.
          toast.error(data.error ?? "This draft is no longer awaiting review.");
          setLoading(null);
          router.refresh();
          return;
        }
        setBannedBlock(data.bannedTerms ?? []);
        setLoading(null);
        return;
      }
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
            `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Edit the draft manually or start fresh.`,
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

  // Permanently removes the draft. Published drafts are blocked server-side
  // (409); those stay as a permanent record and should be archived instead.
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ??
            "This draft was published, so it can't be deleted. Archive it instead.",
        );
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete.");
      }
      toast.success("Draft deleted.");
      router.push("/emails");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // One-click blog spin-off: starts a fresh blog draft on the same topic (no
  // re-briefing), then drops onto its review page where generation streams in.
  async function handleCreateBlog() {
    setCreatingBlog(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/create-blog`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(data.error ?? "Failed to start blog post.", data);
      }
      const data = (await res.json()) as { draftId?: string };
      if (!data.draftId) throw new Error("Failed to start blog post.");
      router.push(`/drafts/${data.draftId}`);
    } catch (e) {
      toastApiError(toast, e instanceof ApiError ? e : null, "Failed to start blog post.");
      setCreatingBlog(false);
    }
  }

  // One-click flyer spin-off: starts a social flyer draft that distills THIS
  // email's copy into a post graphic, then drops onto its review page.
  async function handleCreateFlyer() {
    setCreatingFlyer(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/create-flyer`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(data.error ?? "Failed to start the flyer.", data);
      }
      const data = (await res.json()) as { draftId?: string };
      if (!data.draftId) throw new Error("Failed to start the flyer.");
      router.push(`/drafts/${data.draftId}`);
    } catch (e) {
      toastApiError(toast, e instanceof ApiError ? e : null, "Failed to start the flyer.");
      setCreatingFlyer(false);
    }
  }

  // Sends the approved email through MailerLite directly, immediately or at a
  // chosen time, no separate manual step in the MailerLite dashboard.
  // Idempotent server-side (the pipeline's publications row check + the
  // route return alreadyPublished), so a double-click never double-sends.
  async function handlePublish(
    schedule: { type: "instant" } | { type: "scheduled"; date: string; hours: string; minutes: string } = {
      type: "instant",
    },
  ) {
    setPublishing(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "mailerlite", schedule }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        target?: string;
        externalId?: string;
        url?: string;
        alreadyPublished?: boolean;
        status?: string;
        scheduledFor?: string;
        scheduleError?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to publish.");
      setPublication({
        id: "",
        job_id: "",
        target: data.target ?? "mailerlite",
        external_id: data.externalId ?? null,
        url: data.url ?? null,
        published_at: "",
        status: data.status ?? "sent",
        scheduled_for: data.scheduledFor ?? null,
      });
      setShowSchedule(false);
      if (data.alreadyPublished) {
        toast.success("Already in MailerLite, nothing sent twice.");
      } else if (data.status === "draft") {
        toast.error(
          data.scheduleError
            ? `Created in MailerLite but scheduling failed: ${data.scheduleError}`
            : "Created in MailerLite but couldn't confirm delivery. Check MailerLite directly.",
        );
      } else if (data.status === "scheduled") {
        toast.success("Scheduled in MailerLite.");
      } else {
        toast.success("Sent via MailerLite.");
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to publish.");
    } finally {
      setPublishing(false);
    }
  }

  function handleScheduleSubmit() {
    if (!scheduleDateTime) return;
    const [date, time] = scheduleDateTime.split("T");
    const [hours, minutes] = (time ?? "").split(":");
    if (!date || !hours || !minutes) return;
    void handlePublish({ type: "scheduled", date, hours, minutes });
  }

  // Why the Reject button won't respond, surfaced via tooltip since the
  // explanatory text used to live only inside the sheet it opens — which
  // never opens once the button is disabled, making the reason unreachable.
  const rejectDisabledReason = atCap
    ? `Max revisions (${MAX_DRAFT_VERSIONS}) reached. Edit the draft manually or start fresh.`
    : rejectedThisDraft
      ? "A new version is already being generated for this draft."
      : busy
        ? "Please wait for the current action to finish."
        : null;

  return (
    <div className="space-y-5">
      {/* Live preview: the draft is the hero of this screen; every tool
          orbits it. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-[13px] font-medium text-muted">
            Click a section to select it, double-click to type on it
          </p>
          <div className="flex items-center gap-3">
            <Tooltip
              label={
                darkSupported
                  ? "Preview and download this email locked to light or dark."
                  : "This draft doesn't have dark-mode styling. Reject & regenerate to get a version that supports it."
              }
              side="bottom"
            >
              <SegmentedControl
                size="sm"
                value={previewMode}
                onChange={setPreviewMode}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "light", label: "Light", disabled: !darkSupported },
                  { value: "dark", label: "Dark", disabled: !darkSupported },
                ]}
              />
            </Tooltip>
            <button
              type="button"
              onClick={handleDownload}
              className="text-[12px] font-medium text-muted transition-colors hover:text-foreground"
            >
              Download .html
            </button>
          </div>
        </div>
        <EmailPreview
          draftId={draftId}
          html={html}
          onHtmlChange={setHtml}
          initialImage={initialMeta.hero_image}
          onEdited={() => setHistoryRefreshKey((k) => k + 1)}
          previewMode={previewMode}
        />
      </Card>

      <DesignChat
        key={historyRefreshKey}
        draftId={draftId}
        html={html}
        onHtmlChange={setHtml}
      />

      {/* Editable copy */}
      <Card className="space-y-4 p-5">
        <h3 className="text-[15px] font-semibold">Email details</h3>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        {subjectVariants.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-muted">Other subject line ideas, click one to use it:</p>
            <div className="flex flex-wrap gap-1.5">
              {subjectVariants.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => setSubject(variant)}
                  className={`rounded-full border px-3 py-1 text-left text-[12px] transition-colors ${
                    variant === subject
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border text-muted hover:border-accent/50 hover:text-foreground"
                  }`}
                >
                  {variant}
                </button>
              ))}
            </div>
          </div>
        )}
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
            onChange={(e) => setCtaUrl(e.target.value)}
            onBlur={() => commitCtaHref()}
            placeholder="https://…"
          />
        </Field>
      </Card>

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

            {hasUnsupportedSpecifics && (
              <div>
                <p className="mb-1.5 text-danger">
                  Couldn&apos;t verify (no matching fact in the brief or brand):
                </p>
                <ul className="space-y-1 text-foreground/80">
                  {seoData.unsupported_specifics!.map((claim, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-danger">·</span>
                      <span>{claim}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

      {/* Blog spin-off. If a blog already exists for this email, link to it
          instead of offering to create a duplicate; otherwise one click drafts
          a fresh, search-optimized post on the same topic, no re-briefing. */}
      {existingBlog ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Blog post created from this email
            </p>
            <p className="truncate text-[13px] text-muted">
              {existingBlog.subject || "Untitled blog post"}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(`/drafts/${existingBlog.draftId}`)}
          >
            Open blog post
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Create a blog post from this topic
            </p>
            <p className="text-[13px] text-muted">
              Drafts a fresh, search-optimized long-form post on the same topic,
              separate from this email.
            </p>
          </div>
          <Button
            variant="outline"
            loading={creatingBlog}
            disabled={busy}
            onClick={handleCreateBlog}
          >
            Create blog post
          </Button>
        </Card>
      )}

      {/* Flyer spin-off: a social post graphic distilled from THIS email's
          copy. Same link-not-duplicate behavior as the blog card. */}
      {existingFlyer ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Flyer created from this email
            </p>
            <p className="truncate text-[13px] text-muted">
              {existingFlyer.subject || "Untitled flyer"}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(`/drafts/${existingFlyer.draftId}`)}
          >
            Open flyer
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Create a social flyer from this email
            </p>
            <p className="text-[13px] text-muted">
              Designs a Facebook/Instagram post graphic with this email's
              offer, ready to download and post.
            </p>
          </div>
          <Button
            variant="outline"
            loading={creatingFlyer}
            disabled={busy}
            onClick={handleCreateFlyer}
          >
            Create flyer
          </Button>
        </Card>
      )}

      {/* Publish to MailerLite (appears once approved). Mirrors the blog
          screen's Sanity card: shows the existing campaign if already pushed,
          the send/schedule controls when MailerLite is reachable, or a
          connect hint. Approving here is the one explicit action: sending
          goes straight through MailerLite's API, no separate manual step in
          the MailerLite dashboard. */}
      {state === "approved" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          {publication?.external_id ? (
            <>
              <p className="text-sm text-foreground">
                {publication.status === "scheduled" && publication.scheduled_for
                  ? `Scheduled in MailerLite for ${new Date(publication.scheduled_for).toLocaleString()}`
                  : publication.status === "draft"
                    ? "Created in MailerLite, but not scheduled yet"
                    : "Sent via MailerLite"}
                <span className="ml-2 font-mono text-[12px] text-muted">
                  {publication.external_id}
                </span>
              </p>
              {publication.status === "draft" && (
                <p className="text-[13px] text-danger">
                  Scheduling failed. Open MailerLite to finish sending it.
                </p>
              )}
              {publication.url && (
                <a
                  href={publication.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-accent hover:text-accent-press"
                >
                  Open MailerLite →
                </a>
              )}
              <PerformanceStats draftId={draftId} initialMetrics={initialPerformance} />
            </>
          ) : mailerliteConfigured ? (
            <>
              <p className="text-sm text-muted">
                Sends this email through MailerLite immediately, no separate
                step there. Schedule it for later instead if you'd rather.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  loading={publishing && showSchedule}
                  disabled={publishing}
                  onClick={() => setShowSchedule(true)}
                >
                  Schedule for later
                </Button>
                <Button
                  variant="gradient"
                  loading={publishing && !showSchedule}
                  disabled={publishing}
                  onClick={() => void handlePublish()}
                >
                  Send now
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              Connect MailerLite to publish: add an API key in Settings →
              Connections, and set sender name + email in Brand basics.
            </p>
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
              loading={loading === "approve"}
              disabled={busy || rejectedThisDraft}
              onClick={handleApproveClick}
            >
              {loading === "approve"
                ? "Approving…"
                : isEdited
                  ? "Save & approve"
                  : "Approve"}
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
                ? "This draft was rejected. Check for a newer version of this email."
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
        {archived && (
          <span className="text-[13px] text-muted">
            Hidden from the Emails list.
          </span>
        )}
        <Button
          variant="ghost"
          size="lg"
          className="text-danger hover:bg-danger/10"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>
        <div className="flex items-center gap-1 rounded-full border border-border p-1">
          <Tooltip label="I like this email. Write more like it." side="top">
            <button
              type="button"
              onClick={() => void rateDraft("up")}
              disabled={savingThumbs}
              aria-label="Thumbs up: more emails like this"
              aria-pressed={thumbs === "up"}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                thumbs === "up"
                  ? "bg-success/15 text-success"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <ThumbsUpIcon size={16} />
            </button>
          </Tooltip>
          <Tooltip label="Not my style. Steer future emails away from this." side="top">
            <button
              type="button"
              onClick={() => {
                if (thumbs === "down") {
                  void rateDraft("down"); // tapping the active thumb clears it
                } else {
                  setShowDownReason(true);
                }
              }}
              disabled={savingThumbs}
              aria-label="Thumbs down: avoid emails like this"
              aria-pressed={thumbs === "down"}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                thumbs === "down"
                  ? "bg-danger/15 text-danger"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <ThumbsDownIcon size={16} />
            </button>
          </Tooltip>
        </div>
        <span className="ml-auto flex items-center gap-3 text-[12px] text-muted">
          {designLabel && <span title="This draft's visual design direction">{designLabel}</span>}
          {draftCostUsd > 0 && (
            <span>
              This draft cost about ${draftCostUsd < 0.01 ? "0.01" : draftCostUsd.toFixed(2)} to generate.
            </span>
          )}
        </span>
      </div>

      {/* Soft nudge: the quality check found issues; approving is still allowed. */}
      <ConfirmDialog
        open={showQaNudge}
        onClose={() => setShowQaNudge(false)}
        onConfirm={() => void handleApprove()}
        title="Approve with open issues?"
        description={
          (seoData.issues?.length ?? 0) > 0
            ? `The quality check flagged ${seoData.issues!.length} thing${seoData.issues!.length === 1 ? "" : "s"} to improve (listed in the Quality check card). You can approve anyway.`
            : "The quality check didn't pass this draft. You can approve anyway."
        }
        confirmLabel="Approve anyway"
        cancelLabel="Keep editing"
      />

      {/* Hard gate: the server refused because banned words are still in the
          email. Overriding is explicit and deliberate. */}
      <ConfirmDialog
        open={bannedBlock !== null}
        onClose={() => setBannedBlock(null)}
        onConfirm={() => void handleApprove(true)}
        tone="danger"
        title="This email uses words your brand avoids"
        description={
          bannedBlock?.length
            ? `Still in the email: ${bannedBlock.join(", ")}. Edit them out (click the text in the preview), or approve anyway.`
            : "Edit them out (click the text in the preview), or approve anyway."
        }
        confirmLabel="Approve anyway"
        cancelLabel="Keep editing"
      />

      {/* Permanent delete. Published drafts are blocked server-side, so this
          only ever runs on drafts that haven't gone out. */}
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

      {/* Thumbs-down reason: optional, never blocks the rating itself (Skip
          saves a bare "down" exactly like before this existed). */}
      <Sheet
        open={showDownReason}
        onClose={() => {
          setShowDownReason(false);
          setDownReason("");
        }}
        title="What threw you off?"
        description="Optional, but it helps future drafts steer away from this specifically."
        footer={
          <Button
            variant={downReason.trim() ? "solid" : "subtle"}
            className="w-full"
            onClick={submitDownReason}
          >
            {downReason.trim() ? "Save" : "Skip"}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {DOWN_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDownReason(r)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
                downReason === r
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-surface-2 text-foreground hover:bg-surface-3",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <Textarea
          rows={3}
          className="mt-3"
          value={downReason}
          onChange={(e) => setDownReason(e.target.value)}
          placeholder="Anything specific? (optional)"
        />
      </Sheet>

      {/* Schedule for later: date/time only, no timezone field, MailerLite
          applies the account's own default timezone to it. */}
      <Sheet
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        title="Schedule for later"
        description="Picks a future send time. Uses your MailerLite account's timezone."
        footer={
          <div className="flex gap-2">
            <Button
              variant="subtle"
              className="flex-1"
              onClick={() => setShowSchedule(false)}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={publishing}
              disabled={!scheduleDateTime}
              onClick={handleScheduleSubmit}
            >
              Schedule
            </Button>
          </div>
        }
      >
        <Field label="Send at">
          <Input
            type="datetime-local"
            value={scheduleDateTime}
            min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => setScheduleDateTime(e.target.value)}
          />
        </Field>
      </Sheet>
    </div>
  );
}
