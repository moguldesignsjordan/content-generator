import { NextRequest, NextResponse } from "next/server";
import { deleteTopic, getSingleBrand, getTopicContext, updateTopic } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import type { TopicFormData } from "@/lib/db/types";
import { logError } from "@/lib/log";

/** Resolves the caller's brand and confirms the topic (walked through
 * cluster -> pillar -> strategy) belongs to it. */
async function requireOwnTopic(id: string) {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return { ok: false as const, response: NextResponse.json({ error: "No brand found." }, { status: 404 }) };
  }
  const ctx = await getTopicContext(id);
  if (!ctx || ctx.brand.id !== brand.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Topic not found." }, { status: 404 }) };
  }
  return { ok: true as const, ctx };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireOwnTopic(id);
    if (!access.ok) return access.response;

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
    const access = await requireOwnTopic(id);
    if (!access.ok) return access.response;

    // Guard: only idea-stage topics can be deleted.
    if (access.ctx.topic.status !== "idea") {
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
