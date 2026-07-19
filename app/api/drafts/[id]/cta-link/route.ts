import { NextRequest, NextResponse } from "next/server";
import { requireDraftInBrand } from "@/lib/draft-access";
import { applyCtaHref } from "@/lib/email/inline-style";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { logError } from "@/lib/log";

// Deterministic: no model call, so the default timeout is plenty.
export const maxDuration = 30;

/**
 * POST { url } -> { html, history }
 *
 * Commits the CTA button's destination URL right away, the same pattern
 * region-html uses for inline text edits. Without this, the link only lived
 * in client state until Approve was clicked: typing a URL then running a
 * Design Chat edit or Redesign in between (both of which rebuild from the
 * DB's stored meta.email_copy.cta_url, not the browser's unsaved state) would
 * silently drop the just-typed link back to wherever the button pointed
 * before — in practice "#", a dead click. Persisting on every change closes
 * that gap.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = typeof body.url === "string" ? body.url : "";

    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;

    const html = applyCtaHref(draftCtx.content.html, url);
    const extraMeta = draftCtx.meta.email_copy
      ? { email_copy: { ...draftCtx.meta.email_copy, cta_url: url.trim() || undefined } }
      : {};

    const result = await commitHtmlEdit({
      draftCtx,
      html,
      label: "Set the CTA link",
      type: "copy",
      extraMeta,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    logError("api:/api/drafts/[id]/cta-link", err);
    return NextResponse.json(
      { error: "Couldn't save that link. Try again." },
      { status: 500 },
    );
  }
}
