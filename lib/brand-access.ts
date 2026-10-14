import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getBrandWithIcps } from "@/lib/db/queries";
import type { Brand, Strategy } from "@/lib/db/types";

type Fail = { ok: false; response: NextResponse };

/**
 * Settings routes take the brand (or its strategy) from the request body, so
 * each must confirm it's the signed-in user's own before writing; otherwise
 * any signed-in user could edit another brand. Someone else's id gets the
 * same 404 as one that doesn't exist, so a route can't be used to probe ids.
 * The draft equivalent is lib/draft-access.ts.
 */
export async function requireOwnBrand(
  brandId: string | undefined,
): Promise<{ ok: true; brand: Brand; strategy: Strategy | null } | Fail> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const data = await getBrandWithIcps(user.id);
  if (!data || !brandId || data.brand.id !== brandId) {
    return { ok: false, response: NextResponse.json({ error: "Brand not found." }, { status: 404 }) };
  }
  return { ok: true, brand: data.brand, strategy: data.strategy };
}

/** The same check for routes that take a strategy id instead. */
export async function requireOwnStrategy(
  strategyId: string | undefined,
): Promise<{ ok: true; brand: Brand; strategy: Strategy } | Fail> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const data = await getBrandWithIcps(user.id);
  if (!data?.strategy || !strategyId || data.strategy.id !== strategyId) {
    return { ok: false, response: NextResponse.json({ error: "Strategy not found." }, { status: 404 }) };
  }
  return { ok: true, brand: data.brand, strategy: data.strategy };
}
