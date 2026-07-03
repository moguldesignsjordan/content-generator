import { NextRequest, NextResponse } from "next/server";
import { regenerateEmailDraft } from "@/lib/pipeline/generate";
import type { EmailTemplateId } from "@/lib/db/types";

export const maxDuration = 300;

const KNOWN_TEMPLATES: EmailTemplateId[] = [
  "newsletter_tip",
  "newsletter_feature",
  "newsletter_howto",
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

    const override = KNOWN_TEMPLATES.includes(templateOverride as EmailTemplateId)
      ? (templateOverride as EmailTemplateId)
      : undefined;

    const result = await regenerateEmailDraft(id, feedback.trim(), {
      templateOverride: override,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("reject error", err);
    return NextResponse.json({ error: "Failed to regenerate draft" }, { status: 500 });
  }
}
