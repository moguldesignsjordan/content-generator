import { NextRequest, NextResponse } from "next/server";
import {
  deleteContentSchedule,
  getContentSchedule,
  getSingleBrand,
  updateContentSchedule,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import type { BlogType, Cadence, EmailType } from "@/lib/db/types";
import { logError } from "@/lib/log";

async function requireOwnSchedule(id: string) {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return { ok: false as const, response: NextResponse.json({ error: "No brand found." }, { status: 404 }) };
  }
  const schedule = await getContentSchedule(id);
  if (!schedule || schedule.brand_id !== brand.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Schedule not found" }, { status: 404 }) };
  }
  return { ok: true as const, schedule };
}

/** Toggle active (pause/resume), or edit cadence/type override. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireOwnSchedule(id);
    if (!access.ok) return access.response;
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
    const access = await requireOwnSchedule(id);
    if (!access.ok) return access.response;
    await deleteContentSchedule(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/schedules/[id]:delete", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
