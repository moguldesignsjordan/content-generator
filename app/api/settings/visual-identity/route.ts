import { NextRequest, NextResponse } from "next/server";
import { updateVisualIdentity } from "@/lib/db/queries";
import type { VisualIdentity } from "@/lib/db/types";

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
    console.error("visual-identity update error", err);
    return NextResponse.json(
      { error: "Failed to save visual identity" },
      { status: 500 },
    );
  }
}
