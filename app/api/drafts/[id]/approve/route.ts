import { NextRequest, NextResponse } from "next/server";
import { approveDraft } from "@/lib/db/queries";
import type { EmailDraftContent } from "@/lib/db/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      editedContent?: EmailDraftContent;
    };
    await approveDraft(id, body.editedContent);
    return NextResponse.json({ approved: true });
  } catch (err) {
    console.error("approve error", err);
    return NextResponse.json({ error: "Failed to approve draft" }, { status: 500 });
  }
}
