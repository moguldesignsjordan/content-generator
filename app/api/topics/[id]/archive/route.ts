import { NextRequest, NextResponse } from "next/server";
import { archiveTopic, getSingleBrand, getTopicContext } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

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
  return { ok: true as const };
}

/**
 * POST: archives a topic (hides it from the default Content Plan view).
 * Safe for any status, unlike hard delete which stays idea-only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireOwnTopic(id);
    if (!access.ok) return access.response;
    await archiveTopic(id, true);
    return NextResponse.json({ archived: true });
  } catch (err) {
    logError("api:/api/topics/[id]/archive:post", err);
    return NextResponse.json({ error: "Failed to archive topic." }, { status: 500 });
  }
}

/** DELETE: unarchives a topic (brings it back into the default view). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireOwnTopic(id);
    if (!access.ok) return access.response;
    await archiveTopic(id, false);
    return NextResponse.json({ archived: false });
  } catch (err) {
    logError("api:/api/topics/[id]/archive:delete", err);
    return NextResponse.json({ error: "Failed to unarchive topic." }, { status: 500 });
  }
}
