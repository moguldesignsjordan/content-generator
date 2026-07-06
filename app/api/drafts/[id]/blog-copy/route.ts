import { NextRequest, NextResponse } from "next/server";
import {
  getDraftWithJobContext,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { renderBlogPreviewHtml } from "@/lib/blog/render-preview";
import { BlogDraftSchema } from "@/prompts/generate-blog";

/**
 * Saves an edited article body for a blog draft: validates it with the same
 * schema generation uses (so slugs get the same lowercase-hyphen treatment),
 * replaces meta.blog_copy (the source of truth the Sanity publish reads),
 * re-renders the stored preview HTML from it, and keeps content.subject in
 * sync since that's what drafts lists/getDraftSubject read. In place, no
 * version bump, no model call, mirrors the hero-image commit path.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Send the edited article as JSON." },
        { status: 400 },
      );
    }

    const parsed = BlogDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That article isn't valid." },
        { status: 400 },
      );
    }
    const copy = parsed.data;

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    if (draftCtx.jobType !== "blog") {
      return NextResponse.json(
        { error: "Only blog drafts have article copy to edit." },
        { status: 400 },
      );
    }

    const topicCtx = await getTopicContext(draftCtx.topicId);
    if (!topicCtx) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const html = renderBlogPreviewHtml(copy, topicCtx.brand, draftCtx.meta.hero_image);
    await updateDraftContent(
      id,
      { ...draftCtx.content, subject: copy.title, preheader: copy.meta_description, html },
      { ...draftCtx.meta, blog_copy: copy, meta_title: copy.meta_title, meta_description: copy.meta_description },
    );

    return NextResponse.json({ html, copy });
  } catch (err) {
    console.error("[blog-copy] error", err);
    return NextResponse.json(
      { error: "Couldn't save your edits. Try again." },
      { status: 500 },
    );
  }
}
