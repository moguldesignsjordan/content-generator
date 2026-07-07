import { NextRequest, NextResponse } from "next/server";
import { updateVisualIdentity } from "@/lib/db/queries";
import type { VisualIdentity } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function PATCH(req: NextRequest) {
  try {
    const { brandId, visualIdentity } = (await req.json()) as {
      brandId: string;
      visualIdentity: VisualIdentity;
    };
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }
    await updateVisualIdentity(brandId, visualIdentity);
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/settings/visual-identity", err);
    return NextResponse.json(
      { error: "Failed to save visual identity" },
      { status: 500 },
    );
  }
}
