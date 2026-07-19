import { NextRequest, NextResponse } from "next/server";
import { guardDraftAiRoute } from "@/lib/ai-guard";
import { rewriteRegion } from "@/lib/pipeline/rewrite-region";
import { requireDraftInBrand } from "@/lib/draft-access";
import { logError } from "@/lib/log";

// Propose-only, so a single cheap model turn. No commit, no undo entry.
export const maxDuration = 60;

/**
 * POST { label, currentText, instruction?, allowMarkdown? } -> { text }
 *
 * Proposes new wording for one section and RETURNS IT WITHOUT SAVING. The
 * Rewrite modal shows it against the current text; nothing is persisted unless
 * the user accepts, and when they do it is written through the same
 * deterministic path as hand-typed text (region-html for email, blog-copy for
 * blog). Shared by both draft types.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const body = (await req.json().catch(() => ({}))) as {
      label?: string;
      currentText?: string;
      instruction?: string;
      allowMarkdown?: boolean;
    };

    if (!body.label || !body.currentText?.trim()) {
      return NextResponse.json(
        { error: "Which part are you rewriting?" },
        { status: 400 },
      );
    }

    const guard = await guardDraftAiRoute("rewrite-region", id, { limit: 15 });
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error, outOfCredits: guard.outOfCredits, upgradeUrl: guard.upgradeUrl },
        { status: guard.status },
      );
    }

    const result = await rewriteRegion(id, {
      label: body.label,
      currentText: body.currentText,
      instruction: body.instruction?.trim() || undefined,
      allowMarkdown: body.allowMarkdown === true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ text: result.text });
  } catch (err) {
    logError("api:/api/drafts/[id]/rewrite-region", err);
    return NextResponse.json(
      { error: "Couldn't write a new version. Try again." },
      { status: 500 },
    );
  }
}
