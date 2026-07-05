import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext } from "@/lib/db/queries";
import { applyStyleChanges, locateRegion, type StyleChanges } from "@/lib/email/inline-style";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";

// Native (no model) style edit on one region: a mechanical inline-style
// mutation, so this never needs model headroom. Sibling to /copy and
// /adjust-style, but deterministic — no retry ladder, no thinking.
export const maxDuration = 30;

const CHANGE_KEYS: (keyof StyleChanges)[] = [
  "color",
  "background",
  "margin",
  "fontSize",
  "textAlign",
  "fontWeight",
];

/**
 * POST { region, regionIndex, regionLabel, changes }: applies one or more
 * CSS property changes to the region's own opening tag in place (no new
 * draft version). `regionIndex` is the region's 0-based occurrence in the
 * document (a region like "body" can repeat) — the element is located by
 * scanning the stored HTML, never by a client-sent snippet.
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
      changes?: StyleChanges;
    };

    if (!body.region || !body.regionLabel || typeof body.regionIndex !== "number") {
      return NextResponse.json(
        { error: "Which part of the email are you editing?" },
        { status: 400 },
      );
    }

    const changes: StyleChanges = {};
    for (const key of CHANGE_KEYS) {
      const value = body.changes?.[key];
      if (value) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

    const located = locateRegion(draftCtx.content.html, body.region, body.regionIndex);
    if (!located) {
      return NextResponse.json(
        { error: "Couldn't find that part of the email. Try reloading." },
        { status: 409 },
      );
    }

    const newElement = applyStyleChanges(located.outerHTML, changes);
    const newHtml =
      draftCtx.content.html.slice(0, located.start) +
      newElement +
      draftCtx.content.html.slice(located.end);

    const result = await commitHtmlEdit({
      draftCtx,
      html: newHtml,
      label: `Styled ${body.regionLabel.toLowerCase()}`,
      type: "style",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    console.error("[style-edit] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that change. Try again." },
      { status: 500 },
    );
  }
}
