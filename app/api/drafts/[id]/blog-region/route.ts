import { NextRequest, NextResponse } from "next/server";
import { getTopicContext, updateDraftContent } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { renderBlogPreviewHtml } from "@/lib/blog/render-preview";
import { htmlToMarkdown } from "@/lib/blog/from-html";
import { sanitizeEditedFragment } from "@/lib/editor/sanitize-fragment";
import { BlogDraftSchema } from "@/prompts/generate-blog";
import { logError } from "@/lib/log";
import type { BlogCopy } from "@/lib/db/types";

// Deterministic: no model call.
export const maxDuration = 30;

/** Fields that carry formatting, and so round-trip through markdown. */
const MARKDOWN_FIELDS = new Set(["intro", "section-body", "conclusion"]);

/**
 * POST { field, index, innerHtml } -> { html, copy }
 *
 * The blog twin of /region-html, and the reason the two review screens can
 * share one editor: an inline edit arrives as HTML either way, and each type
 * just knows how to store it. An email splices the HTML back into its stored
 * document; a blog converts it back to the markdown that blog_copy holds (and
 * that Sanity publishing reads), then re-renders the preview from the
 * structured copy.
 *
 * The conversion runs HERE rather than in the browser so that cheerio (a full
 * HTML parser) stays out of the client bundle, and so the stored markdown is
 * produced by the same code the round-trip tests cover.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      field?: string;
      index?: number;
      innerHtml?: string;
    };

    const field = body.field;
    const index = typeof body.index === "number" ? body.index : 0;
    if (!field || typeof body.innerHtml !== "string") {
      return NextResponse.json(
        { error: "Which part of the article are you editing?" },
        { status: 400 },
      );
    }

    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;
    if (draftCtx.jobType !== "blog") {
      return NextResponse.json(
        { error: "Only blog drafts have article copy to edit." },
        { status: 400 },
      );
    }
    const current = draftCtx.meta.blog_copy;
    if (!current) {
      return NextResponse.json({ error: "This draft has no article copy." }, { status: 400 });
    }

    // Styles are dropped: a blog article's look comes from the renderer's
    // stylesheet, and an inline style wouldn't survive the markdown conversion
    // anyway.
    const safe = sanitizeEditedFragment(body.innerHtml, { allowStyle: false });
    const value = MARKDOWN_FIELDS.has(field)
      ? htmlToMarkdown(safe)
      : stripToText(safe);

    if (!value.trim()) {
      return NextResponse.json(
        { error: "That part can't be left empty." },
        { status: 400 },
      );
    }

    const next = applyField(current, field, index, value);
    const parsed = BlogDraftSchema.safeParse(next);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That edit isn't valid." },
        { status: 400 },
      );
    }
    const copy = parsed.data;

    const topicCtx = await getTopicContext(draftCtx.topicId);
    if (!topicCtx) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const html = renderBlogPreviewHtml(copy, topicCtx.brand, draftCtx.meta.hero_image);
    await updateDraftContent(
      id,
      {
        subject: copy.title,
        preheader: copy.meta_description,
        html,
      },
      { ...draftCtx.meta, blog_copy: copy },
    );

    return NextResponse.json({ html, copy });
  } catch (err) {
    logError("api:/api/drafts/[id]/blog-region", err);
    return NextResponse.json(
      { error: "Couldn't save that edit. Try again." },
      { status: 500 },
    );
  }
}

/** Visible text of a sanitized fragment, for the fields that hold no formatting. */
function stripToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function applyField(copy: BlogCopy, field: string, index: number, value: string): BlogCopy {
  switch (field) {
    case "title":
      return { ...copy, title: value };
    case "slug":
      // The preview renders the slug as "/how-to-do-x"; the stored value has no slash.
      return { ...copy, slug: value.replace(/^\/+/, "") };
    case "intro":
      return { ...copy, intro: value };
    case "conclusion":
      return { ...copy, conclusion: value };
    case "cta":
      return { ...copy, cta_text: value };
    case "section-heading":
      return {
        ...copy,
        sections: copy.sections.map((s, i) => (i === index ? { ...s, heading: value } : s)),
      };
    case "section-body":
      return {
        ...copy,
        sections: copy.sections.map((s, i) => (i === index ? { ...s, body: value } : s)),
      };
    default:
      return copy;
  }
}
