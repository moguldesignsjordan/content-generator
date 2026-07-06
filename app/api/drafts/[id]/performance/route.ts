import { NextRequest, NextResponse } from "next/server";
import { getPerformanceForDraft, refreshPerformance } from "@/lib/pipeline/performance";

// Plan 2 analytics loop. POST re-fetches from the destination (MailerLite
// campaign reports today); GET reads back the last-fetched snapshot with no
// external call, so the review screen can render stats on load without
// spending a refresh on every page view.
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const metrics = await refreshPerformance(id);
    return NextResponse.json({ metrics });
  } catch (err) {
    console.error("performance refresh error", err);
    const message = err instanceof Error ? err.message : "Couldn't refresh stats.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const metrics = await getPerformanceForDraft(id);
    return NextResponse.json({ metrics });
  } catch (err) {
    console.error("performance fetch error", err);
    return NextResponse.json({ error: "Couldn't load stats." }, { status: 500 });
  }
}
