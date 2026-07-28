import { NextRequest, NextResponse } from "next/server";
import { republishDraft } from "@/lib/pipeline/publish";
import { getSingleBrand, saveApprovedDraftEdits } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { findBannedTerms } from "@/lib/email/quality";
import { getSessionUser } from "@/lib/supabase/server";
import type { DraftMeta, EmailDraftContent } from "@/lib/db/types";
import type { PublishSchedule } from "@/lib/publishing/provider";
import { logError } from "@/lib/log";

// Saves any last edits to an ALREADY-published email and pushes them over the
// existing MailerLite campaign. Approving is therefore not a one-way door: a
// campaign still sitting as a draft or scheduled at MailerLite gets corrected
// in place, with no duplicate campaign and no rebuilding it by hand over there.
//
// A campaign that already went out can't be edited by MailerLite at all; that
// case comes back as a 409 and only proceeds (as a brand new campaign to the
// same audience) when the client re-sends with allowRecreate.
export const maxDuration = 60;

function parseSchedule(body: {
  schedule?: { type?: string; date?: string; hours?: string; minutes?: string };
}): PublishSchedule | undefined {
  const s = body.schedule;
  if (!s || typeof s !== "object") return undefined;
  if (s.type === "scheduled" && s.date && s.hours && s.minutes) {
    return { type: "scheduled", date: s.date, hours: s.hours, minutes: s.minutes };
  }
  return { type: "instant" };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;

    const body = (await req.json().catch(() => ({}))) as {
      target?: string;
      schedule?: { type?: string; date?: string; hours?: string; minutes?: string };
      editedContent?: EmailDraftContent;
      meta?: DraftMeta;
      allowRecreate?: boolean;
      force?: boolean;
    };

    if (draftCtx.state !== "approved") {
      return NextResponse.json(
        {
          error:
            "Only an approved draft can be pushed to MailerLite. Approve it first.",
        },
        { status: 409 },
      );
    }

    // Same banned-terms guarantee as approve: the words the brand avoids can't
    // reach a real send, and an edit made after approval is exactly the path
    // that would otherwise slip past that gate.
    if (!body.force) {
      const user = await getSessionUser();
      if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      const brand = await getSingleBrand(user.id);
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

    // Persist first: republishDraft deliberately re-reads the draft from the
    // DB, so what MailerLite receives is always what's stored, never a
    // separate in-flight copy that could drift from the review screen.
    await saveApprovedDraftEdits(id, body.editedContent, body.meta);

    const outcome = await republishDraft(id, {
      targetId: body.target,
      schedule: parseSchedule(body),
      allowRecreate: body.allowRecreate,
    });
    return NextResponse.json(outcome);
  } catch (err) {
    logError("api:/api/drafts/[id]/republish", err);
    const message = err instanceof Error ? err.message : "Failed to update.";
    // "Already sent" is a decision point, not a dead end: 409 + alreadySent so
    // the client can offer sending it as a new campaign instead.
    const alreadySent = message.includes("already gone out");
    return NextResponse.json(
      { error: message, ...(alreadySent ? { alreadySent: true } : {}) },
      { status: alreadySent ? 409 : 400 },
    );
  }
}
