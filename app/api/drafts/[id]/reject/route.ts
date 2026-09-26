import { NextRequest, NextResponse } from "next/server";
import { regenerateEmailDraft } from "@/lib/pipeline/generate";
import { regenerateBlogDraft } from "@/lib/pipeline/generate-blog";
import { regenerateFlyerDraft } from "@/lib/pipeline/generate-flyer";
import { guardDraftAiRoute } from "@/lib/ai-guard";
import { requireDraftInBrand } from "@/lib/draft-access";
import type { EmailTemplateId } from "@/lib/db/types";
import { switchAngle } from "@/prompts/pick-angle";
import { logError } from "@/lib/log";

// Regeneration runs the same write + QA + revise + critique sequence as a
// fresh generation, so it needs the same headroom (see generate-stream).
export const maxDuration = 600;

const KNOWN_TEMPLATES: EmailTemplateId[] = [
  "newsletter_tip",
  "newsletter_feature",
  "newsletter_howto",
  "promotional_bold",
  "announcement_banner",
  "product_spotlight",
  "digest",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      feedback?: string;
      templateOverride?: string;
      angleIndex?: number;
    };
    const { templateOverride, angleIndex } = body;
    let feedback = body.feedback?.trim();

    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;

    // "Try this angle" (email only): the switch itself is the feedback, so
    // none needs typing.
    if (angleIndex !== undefined) {
      const switched =
        draftCtx.jobType === "email" ? switchAngle(draftCtx.meta.angles, angleIndex) : null;
      if (!switched) {
        return NextResponse.json(
          { error: "That angle isn't available for this draft." },
          { status: 400 },
        );
      }
      feedback ||=
        `Rewrite this email around a different angle: ${switched.angles[angleIndex].hook}`;
    }

    if (!feedback) {
      return NextResponse.json(
        { error: "Feedback is required to regenerate." },
        { status: 400 },
      );
    }

    // A regenerate is a full second generation: the most expensive metered call
    // in the app, and until now the only one with no guard in front of it.
    const guard = await guardDraftAiRoute("generate", id, { limit: 8 });
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error, outOfCredits: guard.outOfCredits, upgradeUrl: guard.upgradeUrl },
        { status: guard.status },
      );
    }

    if (draftCtx.jobType === "blog") {
      const result = await regenerateBlogDraft(id, feedback);
      return NextResponse.json(result);
    }

    if (draftCtx.jobType === "social") {
      const result = await regenerateFlyerDraft(id, feedback);
      return NextResponse.json(result);
    }

    const override = KNOWN_TEMPLATES.includes(templateOverride as EmailTemplateId)
      ? (templateOverride as EmailTemplateId)
      : undefined;

    const result = await regenerateEmailDraft(id, feedback, {
      templateOverride: override,
      angleIndex,
    });
    return NextResponse.json(result);
  } catch (err) {
    logError("api:/api/drafts/[id]/reject", err);
    return NextResponse.json({ error: "Failed to regenerate draft" }, { status: 500 });
  }
}
