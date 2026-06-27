import { NextRequest, NextResponse } from "next/server";
import { regenerateEmailDraft } from "@/lib/pipeline/generate";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { feedback } = (await req.json()) as { feedback?: string };

    if (!feedback?.trim()) {
      return NextResponse.json(
        { error: "Feedback is required to regenerate." },
        { status: 400 },
      );
    }

    const result = await regenerateEmailDraft(id, feedback.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("reject error", err);
    return NextResponse.json({ error: "Failed to regenerate draft" }, { status: 500 });
  }
}
