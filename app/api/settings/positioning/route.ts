import { NextRequest, NextResponse } from "next/server";
import { updatePositioning } from "@/lib/db/queries";
import type { Positioning } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function PATCH(req: NextRequest) {
  try {
    const { brandId, positioning } = (await req.json()) as {
      brandId: string;
      positioning: Positioning;
    };
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }
    await updatePositioning(brandId, positioning);
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/settings/positioning", err);
    return NextResponse.json(
      { error: "Failed to save positioning" },
      { status: 500 },
    );
  }
}
