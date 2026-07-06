import { NextRequest, NextResponse } from "next/server";
import { createContentSchedule, listContentSchedules } from "@/lib/db/queries";
import type { BlogType, Cadence, ContentJobType, EmailType } from "@/lib/db/types";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId is required" }, { status: 400 });
  }
  const schedules = await listContentSchedules(brandId);
  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      brandId?: string;
      channel?: ContentJobType;
      cadence?: Cadence;
      emailType?: EmailType;
      blogType?: BlogType;
    };
    if (!body.brandId || !body.channel || !body.cadence) {
      return NextResponse.json(
        { error: "brandId, channel, and cadence are required" },
        { status: 400 },
      );
    }
    const schedule = await createContentSchedule({
      brandId: body.brandId,
      channel: body.channel,
      cadence: body.cadence,
      emailType: body.emailType,
      blogType: body.blogType,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    console.error("[schedules] create error", err);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
