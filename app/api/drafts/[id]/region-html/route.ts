import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext } from "@/lib/db/queries";
import { locateRegion, replaceRegionInner } from "@/lib/email/inline-style";
import { sanitizeEditedFragment } from "@/lib/editor/sanitize-fragment";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { stripTags, syncEmailCopy } from "@/lib/pipeline/adjust-copy";
import { logError } from "@/lib/log";
import type { DraftMeta } from "@/lib/db/types";

// Deterministic: no model call, so the default timeout is plenty.
export const maxDuration = 30;

/**
 * POST { region, regionIndex, regionLabel, innerHtml } -> { html, history }
 *
 * Commits an inline (contentEditable) edit of one email region. The user typed
 * on the real rendered element, so `innerHtml` is already the markup they want:
 * paragraphs, links and bold runs intact. The job here is to put it back into
 * the stored document without disturbing anything else.
 *
 * NO MODEL IS INVOLVED. This replaces the old "Apply text" path, which
 * flattened the region to a single line of plain text before showing it to the
 * user and then rebuilt it from that — destroying multi-paragraph bodies,
 * links and bold every time it ran.
 *
 * The client sanitizes too (for the optimistic paint), but its result is never
 * trusted: the fragment is re-sanitized here, authoritatively, before it goes
 * anywhere near the stored HTML.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      region?: string;
      regionIndex?: number;
      regionLabel?: string;
      innerHtml?: string;
    };

    const { region, regionLabel } = body;
    const regionIndex = typeof body.regionIndex === "number" ? body.regionIndex : 0;

    if (!region || !regionLabel || typeof body.innerHtml !== "string") {
      return NextResponse.json(
        { error: "Which part of the email are you editing?" },
        { status: 400 },
      );
    }

    const safeInner = sanitizeEditedFragment(body.innerHtml, { allowStyle: true });
    if (!safeInner.trim()) {
      return NextResponse.json(
        { error: "A section can't be left empty. Delete it instead." },
        { status: 400 },
      );
    }

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    const currentHtml = draftCtx.content.html;
    const located = locateRegion(currentHtml, region, regionIndex);
    if (!located) {
      return NextResponse.json(
        { error: "That section couldn't be found. Refresh and try again." },
        { status: 409 },
      );
    }

    const spliced = replaceRegionInner(currentHtml, region, regionIndex, safeInner);
    if ("error" in spliced) {
      return NextResponse.json({ error: spliced.error }, { status: 409 });
    }

    // Keep the structured copy in step with the HTML, or a later redesign
    // (which rebuilds from email_copy) would quietly undo what was just typed.
    const extraMeta: Partial<DraftMeta> = {};
    if (draftCtx.meta.email_copy) {
      const synced = syncEmailCopy(
        draftCtx.meta.email_copy,
        stripTags(located.innerHTML),
        stripTags(safeInner),
      );
      if (synced !== draftCtx.meta.email_copy) extraMeta.email_copy = synced;
    }

    const result = await commitHtmlEdit({
      draftCtx,
      html: spliced.html,
      label: `Edited ${regionLabel.toLowerCase()}`,
      type: "copy",
      extraMeta,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    logError("api:/api/drafts/[id]/region-html", err);
    return NextResponse.json(
      { error: "Couldn't save that edit. Try again." },
      { status: 500 },
    );
  }
}
