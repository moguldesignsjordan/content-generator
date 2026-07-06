import { NextRequest, NextResponse } from "next/server";
import { publishDraft } from "@/lib/pipeline/publish";
import type { PublishSchedule } from "@/lib/publishing/provider";

// Pushes an approved draft to its destination (blog → Sanity, email →
// MailerLite) through the provider registry. Idempotent: repeat calls return
// the existing publication instead of double-posting.
export const maxDuration = 60;

function parseSchedule(body: unknown): PublishSchedule | undefined {
  const schedule = (body as { schedule?: unknown })?.schedule;
  if (!schedule || typeof schedule !== "object") return undefined;
  const s = schedule as { type?: string; date?: string; hours?: string; minutes?: string };
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
    const body = (await req.json().catch(() => ({}))) as { target?: string };
    const outcome = await publishDraft(id, body.target, parseSchedule(body));
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("publish error", err);
    const message = err instanceof Error ? err.message : "Failed to publish.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
