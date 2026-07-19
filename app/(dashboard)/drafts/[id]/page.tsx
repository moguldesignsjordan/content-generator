import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getBlogDraftFromEmail,
  getBrandIntegration,
  getDraftForReview,
  getDraftSubject,
  getFlyerDraftFromEmail,
  getPublicationForDraft,
  getSingleBrand,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { updateDraftContent } from "@/lib/db/queries";
import { ensureEditableRegions } from "@/lib/email/inline-style";
import { resolveSanityConfig } from "@/lib/clients/sanity";
import { resolveMailerliteConfig } from "@/lib/publishing/providers/mailerlite";
import { getPerformanceForDraft } from "@/lib/pipeline/performance";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../../_components/screen-header";
import { DraftStateBadge } from "../../_components/topic-badges";
import { ReviewActions } from "./_components/review-actions";
import { BlogReviewActions } from "./_components/blog-review-actions";
import { FlyerReviewActions } from "./_components/flyer-review-actions";
import { GenerationProgress } from "./_components/generation-progress";

export const dynamic = "force-dynamic";

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getSingleBrand(user.id);
  if (!brand) notFound();
  const draft = await getDraftForReview(id, brand.id);
  if (!draft) notFound();

  const generation = draft.meta.generation;
  const isGenerating =
    generation ? generation.status !== "ready" : !draft.content.html;
  const isBlog = draft.job_type === "blog";
  const isFlyer = draft.job_type === "social";
  const publication = await getPublicationForDraft(id).catch(() => null);
  const performance = publication
    ? await getPerformanceForDraft(id).catch(() => [])
    : [];

  // Resolve the cross-link between paired drafts: a blog's source email (via
  // meta.source_draft_id), or — for an email — the blog already spun off it.
  // Each review screen uses whichever side applies to link to the other.
  const sourceDraftId = draft.meta.source_draft_id ?? null;
  const sourceSubject =
    (isBlog || isFlyer) && sourceDraftId
      ? await getDraftSubject(sourceDraftId).catch(() => null)
      : null;
  const isEmail = !isBlog && !isFlyer;

  // Older drafts can hold copy the model left outside any data-region — dead
  // to the inline editor. Repair the stored document on open (new generations
  // and every edit already run this), persisting in place: the editor's save
  // paths locate regions by occurrence index in the STORED html, so a
  // preview-only fix would leave client and server counting different
  // documents. No history entry; the visible email doesn't change.
  if (isEmail && !isGenerating && draft.content.html) {
    const normalized = ensureEditableRegions(draft.content.html);
    if (normalized !== draft.content.html) {
      draft.content = { ...draft.content, html: normalized };
      await updateDraftContent(draft.id, draft.content).catch(() => {});
    }
  }

  const existingBlog = isEmail
    ? await getBlogDraftFromEmail(id, brand.id).catch(() => null)
    : null;
  const existingFlyer = isEmail
    ? await getFlyerDraftFromEmail(id, brand.id).catch(() => null)
    : null;

  // The blog publish card shows when Sanity is reachable through the brand's
  // saved connection OR the env-var fallback.
  let sanityConfigured = false;
  // The email publish card shows when MailerLite can actually send: an API key
  // AND a sender identity (name + verified email). That mirrors the provider's
  // own preflight so the button never offers a path that would just throw.
  let mailerliteConfigured = false;
  if (isFlyer) {
    // Flyers publish by download in v1; no provider config to probe.
  } else if (isBlog) {
    const brand = await getSingleBrand(user.id).catch(() => null);
    const integration = brand
      ? await getBrandIntegration(brand.id, "sanity").catch(() => null)
      : null;
    sanityConfigured = resolveSanityConfig(integration) !== null;
  } else {
    const brand = await getSingleBrand(user.id).catch(() => null);
    const integration = brand
      ? await getBrandIntegration(brand.id, "mailerlite").catch(() => null)
      : null;
    if (brand) {
      const ml = resolveMailerliteConfig(brand, integration);
      mailerliteConfigured = Boolean(
        ml.apiKey && ml.senderName && ml.senderEmail,
      );
    }
  }

  return (
    <>
      <Link
        href={isBlog ? "/blogs" : isFlyer ? "/flyers" : "/emails"}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> {isBlog ? "Blogs" : isFlyer ? "Flyers" : "Emails"}
      </Link>
      <ScreenHeader
        title={
          draft.topic_title ??
          draft.content.subject ??
          (isBlog ? "Blog draft" : isFlyer ? "Flyer draft" : "Email draft")
        }
        subtitle={`${isBlog ? "Blog post · " : isFlyer ? "Flyer · " : ""}Version ${draft.version}`}
        actions={<DraftStateBadge state={draft.state} />}
      />

      {/* Blog/flyer → source email: a small link back to the email this grew out of. */}
      {(isBlog || isFlyer) && sourceDraftId && (
        <Link
          href={`/drafts/${sourceDraftId}`}
          className="mb-4 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border bg-surface-2/60 px-3 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon size={13} className="shrink-0" />
          <span className="truncate">
            From email{sourceSubject ? `: “${sourceSubject}”` : ""}
          </span>
        </Link>
      )}

      {isGenerating ? (
        <GenerationProgress
          draftId={draft.id}
          topicTitle={draft.topic_title}
          initialPhase={generation?.phase}
          initialLabel={generation?.label}
        />
      ) : isFlyer ? (
        <FlyerReviewActions
          draftId={draft.id}
          version={draft.version}
          state={draft.state}
          initialMeta={draft.meta}
          initialArchived={draft.archived}
        />
      ) : isBlog ? (
        <BlogReviewActions
          draftId={draft.id}
          version={draft.version}
          state={draft.state}
          initialContent={draft.content}
          initialMeta={draft.meta}
          seoData={draft.seo_data}
          initialArchived={draft.archived}
          publication={publication}
          sanityConfigured={sanityConfigured}
        />
      ) : (
        <ReviewActions
          draftId={draft.id}
          version={draft.version}
          state={draft.state}
          initialContent={draft.content}
          initialMeta={draft.meta}
          seoData={draft.seo_data}
          initialArchived={draft.archived}
          existingBlog={existingBlog}
          existingFlyer={existingFlyer}
          publication={publication}
          mailerliteConfigured={mailerliteConfigured}
          initialPerformance={performance}
          initialFeedback={draft.feedback}
        />
      )}
    </>
  );
}
