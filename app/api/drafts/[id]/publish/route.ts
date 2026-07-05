import { NextRequest, NextResponse } from "next/server";
import { publishDraft } from "@/lib/pipeline/publish";

// Pushes an approved draft to its destination (blog → Sanity, email →
// MailerLite) through the provider registry. Idempotent: repeat calls return
// the existing publication instead of double-posting.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { target?: string };
    const outcome = await publishDraft(id, body.target);
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("publish error", err);
    const message = err instanceof Error ? err.message : "Failed to publish.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
