import { NextRequest, NextResponse } from "next/server";
import { getSingleBrand } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { metaLoginUrl, resolveMetaApp } from "@/lib/clients/meta";
import { CALLBACK_PATH, STATE_COOKIE, newState, redirectUri } from "../oauth";

/**
 * Sends the signed-in user to Facebook's login dialog. The `state` cookie ties
 * the callback to this browser so a forged callback can't attach someone
 * else's Page to this brand.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const brand = await getSingleBrand(user.id);
  if (!brand) return NextResponse.redirect(`${origin}/settings?meta=error`);

  const app = resolveMetaApp();
  if (!app) return NextResponse.redirect(`${origin}/settings?meta=not-configured`);

  const state = newState();
  const res = NextResponse.redirect(metaLoginUrl(app, redirectUri(origin), state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: CALLBACK_PATH,
  });
  return res;
}
