import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext } from "@/lib/db/queries";
import {
  applyCtaStyleChanges,
  applyStyleChanges,
  locateRegion,
  replaceCtaText,
  type StyleChanges,
} from "@/lib/email/inline-style";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { logError } from "@/lib/log";

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
 * POST { region, regionIndex, regionLabel, changes?, buttonText? }: applies
 * one or more CSS property changes to the region's own opening tag in place
 * (no new draft version). `regionIndex` is the region's 0-based occurrence in
 * the document (a region like "body" can repeat) — the element is located by
 * scanning the stored HTML, never by a client-sent snippet. `buttonText`
 * (CTA only) relabels the button's <a> with plain text — the deterministic
 * no-AI wording change, kept out of the contentEditable save path so the
 * button markup can never be damaged.
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
      buttonText?: string;
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
    const buttonText =
      body.region === "cta" && typeof body.buttonText === "string"
        ? body.buttonText.trim().slice(0, 200)
        : "";
    if (Object.keys(changes).length === 0 && !buttonText) {
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

    // The CTA is two elements (wrapper + <a> button); its text/fill styling
    // must land on the button itself to be visible.
    let newElement =
      body.region === "cta"
        ? applyCtaStyleChanges(located.outerHTML, changes)
        : applyStyleChanges(located.outerHTML, changes);
    if (buttonText) newElement = replaceCtaText(newElement, buttonText);
    const newHtml =
      draftCtx.content.html.slice(0, located.start) +
      newElement +
      draftCtx.content.html.slice(located.end);

    const result = await commitHtmlEdit({
      draftCtx,
      html: newHtml,
      label: buttonText
        ? `Changed the button to "${buttonText}"`
        : `Styled ${body.regionLabel.toLowerCase()}`,
      type: "style",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    logError("api:/api/drafts/[id]/style-edit", err);
    return NextResponse.json(
      { error: "Couldn't apply that change. Try again." },
      { status: 500 },
    );
  }
}
