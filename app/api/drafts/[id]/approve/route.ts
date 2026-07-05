import { NextRequest, NextResponse } from "next/server";
import { approveDraft, getDraftWithJobContext, getSingleBrand } from "@/lib/db/queries";
import { findBannedTerms } from "@/lib/email/quality";
import type { DraftMeta, EmailDraftContent } from "@/lib/db/types";

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

    // Code-level banned-terms gate: the QA pass only DETECTS banned vocabulary;
    // this is the guarantee it can't ship. Re-scan the HTML that would actually
    // be approved (edits included) and refuse unless explicitly overridden.
    if (!body.force) {
      const brand = await getSingleBrand();
      const terms = brand?.voice_profile?.banned_terms ?? [];
      if (terms.length) {
        const html =
          body.editedContent?.html ??
          (await getDraftWithJobContext(id))?.content?.html ??
          "";
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
    console.error("approve error", err);
    return NextResponse.json({ error: "Failed to approve draft" }, { status: 500 });
  }
}
