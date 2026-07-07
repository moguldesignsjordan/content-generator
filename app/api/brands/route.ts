import { NextRequest, NextResponse } from "next/server";
import { createBrand } from "@/lib/db/queries";
import { logError } from "@/lib/log";

/**
 * Creates a minimal brand row (name only), the first step of onboarding when
 * no brand exists yet. Subsequent onboarding steps fill in the profile.
 * Single-brand v1: if a brand already exists, that's returned instead.
 */
export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const brand = await createBrand(name);
    return NextResponse.json({ id: brand.id, name: brand.name });
  } catch (err) {
    logError("api:/api/brands:post", err);
    return NextResponse.json(
      { error: "Failed to create brand" },
      { status: 500 },
    );
  }
}
