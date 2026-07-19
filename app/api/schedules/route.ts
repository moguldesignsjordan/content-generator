import { NextRequest, NextResponse } from "next/server";
import { createContentSchedule, getSingleBrand, listContentSchedules } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import type { BlogType, Cadence, ContentJobType, EmailType } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function GET(req: NextRequest) {
  const requestedBrandId = req.nextUrl.searchParams.get("brandId");
  if (!requestedBrandId) {
    return NextResponse.json({ error: "brandId is required" }, { status: 400 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const brand = await getSingleBrand(user.id);
  if (!brand || brand.id !== requestedBrandId) {
    return NextResponse.json({ error: "No brand found" }, { status: 404 });
  }
  const schedules = await listContentSchedules(brand.id);
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
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand || brand.id !== body.brandId) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const schedule = await createContentSchedule({
      brandId: brand.id,
      channel: body.channel,
      cadence: body.cadence,
      emailType: body.emailType,
      blogType: body.blogType,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    logError("api:/api/schedules:post", err);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
