import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftForReview } from "@/lib/db/queries";
import { ReviewActions } from "./_components/review-actions";

export const dynamic = "force-dynamic";

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraftForReview(id);
  if (!draft) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Back to topics
      </Link>

      <header className="mt-4 mb-6">
        <p className="text-sm text-muted">
          Email draft · v{draft.version} · {draft.state.replace("_", " ")}
        </p>
        {draft.topic_title && (
          <h1 className="mt-1 text-xl font-semibold">{draft.topic_title}</h1>
        )}
      </header>

      <ReviewActions
        draftId={draft.id}
        version={draft.version}
        initialContent={draft.content}
        initialMeta={draft.meta}
        seoData={draft.seo_data}
      />
    </main>
  );
}
