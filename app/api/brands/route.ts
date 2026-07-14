import { NextRequest, NextResponse } from "next/server";
import { grantStarterCredits } from "@/lib/billing/credits";
import { createBrand, getBrandForUser } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * Creates a minimal brand row (name only), the first step of onboarding when
 * the user has no brand yet. Subsequent onboarding steps fill in the profile.
 * The creating user becomes the brand's owner (brand_members), which is what
 * scopes every later read to them. One brand per user for now: if they already
 * have one, that's returned instead of creating a second.
 */
export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const existing = await getBrandForUser(sessionUser.id);
    if (existing) {
      return NextResponse.json({ id: existing.id, name: existing.name });
    }
    const brand = await createBrand(name, sessionUser.id);
    // Free credits to start. Idempotent per brand, and deliberately not fatal:
    // a failed grant must not block onboarding, it just leaves a brand at zero
    // balance that the monthly allowance cron will top up anyway.
    await grantStarterCredits(brand.id);
    return NextResponse.json({ id: brand.id, name: brand.name });
  } catch (err) {
    logError("api:/api/brands:post", err);
    return NextResponse.json(
      { error: "Failed to create brand" },
      { status: 500 },
    );
  }
}
