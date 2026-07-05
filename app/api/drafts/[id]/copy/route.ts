import { NextRequest, NextResponse } from "next/server";
import { adjustCopy } from "@/lib/pipeline/adjust-copy";
import { getDraftWithJobContext } from "@/lib/db/queries";
import { locateRegion, replaceRegionText } from "@/lib/email/inline-style";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import type { CopyMode } from "@/prompts/adjust-copy";

// Inline wording edit on one region: cheap, no thinking, but leave headroom
// for a slow model turn or the Sonnet fallback. Sibling to /adjust-style.
export const maxDuration = 120;

/**
 * POST { region, regionIndex, regionLabel, snippet, mode, newText?,
 * instruction? }: edits the WORDING of the clicked region in place (no new
 * draft version). `mode: "edit"` swaps in the user's `newText` verbatim —
 * tried natively first (no model call) via `regionIndex`, falling back to
 * the AI path only for regions whose structure `replaceRegionText` doesn't
 * special-case (e.g. header/footer) or if the region moved since the client
 * last read it. `mode: "regenerate"` always rewrites the region's text with
 * the model, optionally shaped by `instruction`.
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
      snippet?: string;
      mode?: string;
      newText?: string;
      instruction?: string;
    };

    if (!body.region || !body.regionLabel || !body.snippet) {
      return NextResponse.json(
        { error: "Which part of the email are you editing?" },
        { status: 400 },
      );
    }
    const mode: CopyMode = body.mode === "regenerate" ? "regenerate" : "edit";
    if (mode === "edit" && !body.newText?.trim()) {
      return NextResponse.json({ error: "Write some new text." }, { status: 400 });
    }

    if (mode === "edit" && typeof body.regionIndex === "number") {
      const native = await tryNativeTextEdit(id, body.region, body.regionIndex, body.regionLabel, body.newText!.trim());
      if (native) return native;
    }

    const result = await adjustCopy(id, {
      regionCtx: {
        region: body.region,
        label: body.regionLabel,
        snippet: body.snippet,
      },
      mode,
      newText: body.newText,
      instruction: body.instruction?.trim() || undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({
      html: result.html,
      history: result.history,
      caveat: result.caveat,
    });
  } catch (err) {
    console.error("[copy] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that edit. Try again." },
      { status: 500 },
    );
  }
}

/**
 * Attempts a deterministic, no-model text swap. Returns the response to send
 * on success, or `null` to fall through to the AI path (region not found at
 * that index anymore, or its structure isn't one `replaceRegionText`
 * special-cases).
 */
async function tryNativeTextEdit(
  draftId: string,
  region: string,
  regionIndex: number,
  regionLabel: string,
  newText: string,
): Promise<NextResponse | null> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return null;

  const located = locateRegion(draftCtx.content.html, region, regionIndex);
  if (!located) return null;

  const newElement = replaceRegionText(located.outerHTML, region, newText);
  if (newElement === null) return null;

  const newHtml =
    draftCtx.content.html.slice(0, located.start) +
    newElement +
    draftCtx.content.html.slice(located.end);

  const result = await commitHtmlEdit({
    draftCtx,
    html: newHtml,
    label: `Edited ${regionLabel.toLowerCase()} wording`,
    type: "copy",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ html: result.html, history: result.history });
}
