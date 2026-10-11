import { NextRequest, NextResponse } from "next/server";
import {
  deleteBrandIntegration,
  getSingleBrand,
  upsertBrandIntegration,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import {
  exchangeCode,
  listPages,
  pickPage,
  resolveMetaApp,
  toLongLivedUserToken,
} from "@/lib/clients/meta";
import { encryptSecret } from "@/lib/crypto/secrets";
import { logError } from "@/lib/log";
import { CALLBACK_PATH, STATE_COOKIE, redirectUri, statesMatch } from "../oauth";

/**
 * Facebook redirects here after login. Exchanges the code for a long-lived
 * user token, reads the granted Page (its token doesn't expire when read this
 * way), and stores one connection per network: `facebook` for the Page and
 * `instagram` for the linked professional account. Tokens are encrypted at
 * rest like every other credential. Always ends on /settings with a status.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;
  const done = (status: string) => {
    const res = NextResponse.redirect(`${origin}/settings?meta=${status}`);
    res.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: CALLBACK_PATH });
    return res;
  };

  if (params.get("error")) return done("cancelled");
  if (!statesMatch(req.cookies.get(STATE_COOKIE)?.value, params.get("state"))) {
    return done("error");
  }
  const code = params.get("code");
  if (!code) return done("error");

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const brand = await getSingleBrand(user.id);
  if (!brand) return done("error");
  const app = resolveMetaApp();
  if (!app) return done("not-configured");

  try {
    const shortLived = await exchangeCode(app, code, redirectUri(origin));
    const userToken = await toLongLivedUserToken(app, shortLived);
    const page = pickPage(await listPages(userToken));
    if (!page) return done("no-page");

    const pageToken = encryptSecret(page.access_token);
    await upsertBrandIntegration(brand.id, "facebook", {
      pageId: page.id,
      pageName: page.name,
      pageToken,
    });

    const ig = page.instagram_business_account;
    if (ig?.id) {
      await upsertBrandIntegration(brand.id, "instagram", {
        igUserId: ig.id,
        igUsername: ig.username ? `@${ig.username}` : ig.id,
        pageToken,
      });
      return done("connected");
    }
    // A reconnect to a Page without Instagram must not leave posts going to
    // the previously linked account.
    await deleteBrandIntegration(brand.id, "instagram");
    return done("connected-no-instagram");
  } catch (err) {
    logError("api:/api/connections/meta/callback", err, { brandId: brand.id });
    return done("error");
  }
}
