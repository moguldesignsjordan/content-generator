import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext } from "@/lib/db/queries";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import {
  countRegion,
  DELETABLE_REGIONS,
  removeRegion,
} from "@/lib/email/inline-style";
import { logError } from "@/lib/log";

// Delete a single content region (body / eyebrow / headline) from the stored
// email HTML, in place and with no model call. Sibling to /copy and
// /style-edit: same region-by-occurrence scan (locateRegion), same commit path
// (commitHtmlEdit validates, re-asserts the {$unsubscribe} tag, and pushes the
// pre-edit HTML onto the shared undo stack). Structural regions (header,
// footer, cta, image) are refused — deleting them would break the email or, for
// the footer, strip the required unsubscribe merge tag. The last remaining body
// block is also refused so the email keeps content.

/** Cheap, no model call; allow a slow DB write but no thinking budget. */
export const maxDuration = 60;

/**
 * POST { region, regionIndex, regionLabel }: removes the clicked region from
 * the draft HTML. Returns { html, history }, mirroring the other edit routes.
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
    };

    if (!body.region || !body.regionLabel) {
      return NextResponse.json(
        { error: "Which part of the email are you deleting?" },
        { status: 400 },
      );
    }
    if (!DELETABLE_REGIONS.includes(body.region as (typeof DELETABLE_REGIONS)[number])) {
      return NextResponse.json(
        {
          error:
            "That part of the email can't be deleted (only body, eyebrow, and headline blocks can).",
        },
        { status: 400 },
      );
    }
    const regionIndex =
      typeof body.regionIndex === "number" ? body.regionIndex : 0;

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    // Don't let the last body block go — an email needs some content.
    if (body.region === "body" && countRegion(draftCtx.content.html, "body") <= 1) {
      return NextResponse.json(
        { error: "An email needs at least one body block, so this one can't be deleted." },
        { status: 400 },
      );
    }

    const removed = removeRegion(draftCtx.content.html, body.region, regionIndex);
    if ("error" in removed) {
      return NextResponse.json({ error: removed.error }, { status: 404 });
    }

    const result = await commitHtmlEdit({
      draftCtx,
      html: removed.html,
      label: `Deleted ${body.regionLabel.toLowerCase()}`,
      type: "delete",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    logError("api:/api/drafts/[id]/delete-region", err);
    return NextResponse.json(
      { error: "Couldn't delete that section. Try again." },
      { status: 500 },
    );
  }
}
