import { NextRequest, NextResponse } from "next/server";
import { deleteContentSchedule, updateContentSchedule } from "@/lib/db/queries";
import type { BlogType, Cadence, EmailType } from "@/lib/db/types";
import { logError } from "@/lib/log";

/** Toggle active (pause/resume), or edit cadence/type override. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const patch = (await req.json()) as {
      active?: boolean;
      cadence?: Cadence;
      emailType?: EmailType | null;
      blogType?: BlogType | null;
    };
    const schedule = await updateContentSchedule(id, {
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.cadence ? { cadence: patch.cadence } : {}),
      ...(patch.emailType !== undefined ? { email_type: patch.emailType } : {}),
      ...(patch.blogType !== undefined ? { blog_type: patch.blogType } : {}),
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    logError("api:/api/schedules/[id]:patch", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteContentSchedule(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/schedules/[id]:delete", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
