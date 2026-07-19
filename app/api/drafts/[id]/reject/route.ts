import { NextRequest, NextResponse } from "next/server";
import { regenerateEmailDraft } from "@/lib/pipeline/generate";
import { regenerateBlogDraft } from "@/lib/pipeline/generate-blog";
import { regenerateFlyerDraft } from "@/lib/pipeline/generate-flyer";
import { guardDraftAiRoute } from "@/lib/ai-guard";
import { requireDraftInBrand } from "@/lib/draft-access";
import type { EmailTemplateId } from "@/lib/db/types";
import { logError } from "@/lib/log";

export const maxDuration = 300;

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
    const { feedback, templateOverride } = (await req.json()) as {
      feedback?: string;
      templateOverride?: string;
    };

    if (!feedback?.trim()) {
      return NextResponse.json(
        { error: "Feedback is required to regenerate." },
        { status: 400 },
      );
    }

    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;

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
      const result = await regenerateBlogDraft(id, feedback.trim());
      return NextResponse.json(result);
    }

    if (draftCtx.jobType === "social") {
      const result = await regenerateFlyerDraft(id, feedback.trim());
      return NextResponse.json(result);
    }

    const override = KNOWN_TEMPLATES.includes(templateOverride as EmailTemplateId)
      ? (templateOverride as EmailTemplateId)
      : undefined;

    const result = await regenerateEmailDraft(id, feedback.trim(), {
      templateOverride: override,
    });
    return NextResponse.json(result);
  } catch (err) {
    logError("api:/api/drafts/[id]/reject", err);
    return NextResponse.json({ error: "Failed to regenerate draft" }, { status: 500 });
  }
}
