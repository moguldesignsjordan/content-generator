import { NextRequest, NextResponse } from "next/server";
import { getIcpBrandId, getSingleBrand, updateIcp } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import type { IcpProfile } from "@/lib/db/types";
import { logError } from "@/lib/log";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }
    const icpBrandId = await getIcpBrandId(id);
    if (!icpBrandId || icpBrandId !== brand.id) {
      return NextResponse.json({ error: "ICP not found." }, { status: 404 });
    }

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
    logError("api:/api/settings/icp/[id]", err);
    return NextResponse.json({ error: "Failed to save ICP" }, { status: 500 });
  }
}
