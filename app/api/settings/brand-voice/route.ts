import { NextRequest, NextResponse } from "next/server";
import { updateBrandVoice } from "@/lib/db/queries";
import type { VoiceProfile } from "@/lib/db/types";

export async function PATCH(req: NextRequest) {
  try {
    const { brandId, voiceProfile } = (await req.json()) as {
      brandId: string;
      voiceProfile: VoiceProfile;
    };
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }
    await updateBrandVoice(brandId, voiceProfile);
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("brand-voice update error", err);
    return NextResponse.json({ error: "Failed to save brand voice" }, { status: 500 });
  }
}
