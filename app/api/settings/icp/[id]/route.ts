import { NextRequest, NextResponse } from "next/server";
import { updateIcp } from "@/lib/db/queries";
import type { IcpProfile } from "@/lib/db/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { label, profile } = (await req.json()) as {
      label: string;
      profile: IcpProfile;
    };
    if (!label?.trim()) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    await updateIcp(id, { label, profile });
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("icp update error", err);
    return NextResponse.json({ error: "Failed to save ICP" }, { status: 500 });
  }
}
