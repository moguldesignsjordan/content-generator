import { NextRequest, NextResponse } from "next/server";
import { approveDraft, getDraftWithJobContext, getSingleBrand } from "@/lib/db/queries";
import { findBannedTerms } from "@/lib/email/quality";
import type { DraftMeta, EmailDraftContent } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      editedContent?: EmailDraftContent;
      meta?: DraftMeta;
      force?: boolean;
    };

    // A draft that's no longer awaiting review (already approved, rejected,
    // or superseded by a newer version) isn't a valid approve target, even if
    // a stale client re-submits. Checked here, not just via the client's
    // disabled button, since that can be bypassed or out of sync.
    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    if (draftCtx.state !== "in_review") {
      return NextResponse.json(
        {
          error: "This draft is no longer awaiting review, so it can't be approved again.",
          notInReview: true,
        },
        { status: 409 },
      );
    }

    // Code-level banned-terms gate: the QA pass only DETECTS banned vocabulary;
    // this is the guarantee it can't ship. Re-scan the HTML that would actually
    // be approved (edits included) and refuse unless explicitly overridden.
    if (!body.force) {
      const brand = await getSingleBrand();
      const terms = brand?.voice_profile?.banned_terms ?? [];
      if (terms.length) {
        const html = body.editedContent?.html ?? draftCtx.content?.html ?? "";
        const found = findBannedTerms(html, terms);
        if (found.length) {
          return NextResponse.json(
            {
              error: `This email still uses words the brand avoids: ${found.join(", ")}.`,
              bannedTerms: found,
            },
            { status: 409 },
          );
        }
      }
    }

    await approveDraft(id, body.editedContent, body.meta);
    return NextResponse.json({ approved: true });
  } catch (err) {
    logError("api:/api/drafts/[id]/approve", err);
    return NextResponse.json({ error: "Failed to approve draft" }, { status: 500 });
  }
}
