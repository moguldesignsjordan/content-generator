import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftForReview, getPublicationForDraft } from "@/lib/db/queries";
import { isSanityConfigured } from "@/lib/clients/sanity";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../../_components/screen-header";
import { DraftStateBadge } from "../../_components/topic-badges";
import { ReviewActions } from "./_components/review-actions";
import { BlogReviewActions } from "./_components/blog-review-actions";
import { GenerationProgress } from "./_components/generation-progress";

export const dynamic = "force-dynamic";

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraftForReview(id);
  if (!draft) notFound();

  const generation = draft.meta.generation;
  const isGenerating =
    generation ? generation.status !== "ready" : !draft.content.html;
  const isBlog = draft.job_type === "blog";
  const publication = isBlog
    ? await getPublicationForDraft(id).catch(() => null)
    : null;

  return (
    <>
      <Link
        href="/emails"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> Emails
      </Link>
      <ScreenHeader
        title={
          draft.topic_title ??
          draft.content.subject ??
          (isBlog ? "Blog draft" : "Email draft")
        }
        subtitle={`${isBlog ? "Blog post · " : ""}Version ${draft.version}`}
        actions={<DraftStateBadge state={draft.state} />}
      />
      {isGenerating ? (
        <GenerationProgress
          draftId={draft.id}
          topicTitle={draft.topic_title}
          initialPhase={generation?.phase}
          initialLabel={generation?.label}
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
          sanityConfigured={isSanityConfigured()}
        />
      ) : (
        <ReviewActions
          draftId={draft.id}
          version={draft.version}
          initialContent={draft.content}
          initialMeta={draft.meta}
          seoData={draft.seo_data}
          initialArchived={draft.archived}
        />
      )}
    </>
  );
}
