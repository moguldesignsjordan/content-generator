import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/db/client";
import { updateTopic, deleteTopic } from "@/lib/db/queries";
import type { TopicFormData } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { data: TopicFormData };

    if (!body.data?.title?.trim()) {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }

    await updateTopic(id, body.data);
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/topics/[id]:patch", err);
    return NextResponse.json({ error: "Failed to update topic." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Guard: only idea-stage topics can be deleted.
    const db = getAdminClient();
    const { data: topic, error: fetchErr } = await db
      .from("topics")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    if (topic.status !== "idea") {
      return NextResponse.json(
        { error: "Only idea-stage topics can be deleted." },
        { status: 409 },
      );
    }

    await deleteTopic(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/topics/[id]:delete", err);
    return NextResponse.json({ error: "Failed to delete topic." }, { status: 500 });
  }
}
