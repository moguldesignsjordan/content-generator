import { NextRequest, NextResponse } from "next/server";
import { regenerateEmailDraft } from "@/lib/pipeline/generate";
import { regenerateBlogDraft } from "@/lib/pipeline/generate-blog";
import { getDraftWithJobContext } from "@/lib/db/queries";
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

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    if (draftCtx.jobType === "blog") {
      const result = await regenerateBlogDraft(id, feedback.trim());
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
