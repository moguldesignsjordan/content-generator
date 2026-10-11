import "server-only";
import { decryptSecret, isEncryptedSecret } from "@/lib/crypto/secrets";
import type { BrandIntegration } from "@/lib/db/types";

// Facebook Graph API, shared by the Connect-with-Facebook flow and the
// facebook/instagram publish providers. Shapes verified against
// developers.facebook.com (2026-10):
//   Login dialog  https://www.facebook.com/<v>/dialog/oauth
//                 ?client_id&redirect_uri&state&config_id&response_type=code
//                 config_id is a "Facebook Login for Business" configuration
//                 (User access token type) that carries the permissions.
//   Code → token  GET /oauth/access_token?client_id&client_secret&redirect_uri&code
//   Long-lived    GET /oauth/access_token?grant_type=fb_exchange_token
//                 &client_id&client_secret&fb_exchange_token
//   Pages         GET /me/accounts?fields=... Page tokens read with a
//                 long-lived user token don't expire.
//
// While the Meta app is in Development mode, posts it publishes are visible
// only to people with a role on the app. Public visibility needs App Review.

export const META_GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  loginConfigId: string;
}

/** Null when any of the three env vars is missing; the connect route reports which. */
export function resolveMetaApp(): MetaAppConfig | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const loginConfigId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (!appId || !appSecret || !loginConfigId) return null;
  return { appId, appSecret, loginConfigId };
}

export const META_ENV_VARS = ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID"];

export function metaLoginUrl(app: MetaAppConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: redirectUri,
    state,
    config_id: app.loginConfigId,
    response_type: "code",
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params}`;
}

/** Meta's error message when it sends one, so a failed call says why. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * One Graph call. GET puts params in the query string; POST sends them as a
 * form body (what the Graph API documents for publishing calls).
 */
export async function graph<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params);
  const url = method === "GET" ? `${GRAPH}${path}?${body}` : `${GRAPH}${path}`;
  const res = await fetch(url, method === "GET" ? undefined : { method, body });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || data.error) {
    throw new MetaApiError(
      data.error?.message ?? `Facebook request failed (${res.status}).`,
      res.status,
      data.error?.code,
    );
  }
  return data as T;
}

export async function exchangeCode(
  app: MetaAppConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const data = await graph<{ access_token: string }>("GET", "/oauth/access_token", {
    client_id: app.appId,
    client_secret: app.appSecret,
    redirect_uri: redirectUri,
    code,
  });
  return data.access_token;
}

export async function toLongLivedUserToken(
  app: MetaAppConfig,
  shortLived: string,
): Promise<string> {
  const data = await graph<{ access_token: string }>("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: shortLived,
  });
  return data.access_token;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

export async function listPages(userToken: string): Promise<MetaPage[]> {
  const data = await graph<{ data?: MetaPage[] }>("GET", "/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userToken,
  });
  return data.data ?? [];
}

/**
 * The login dialog lets the person tick which Pages to grant. With several
 * granted, prefer one that has an Instagram account linked, since that one
 * connects both networks.
 */
export function pickPage(pages: MetaPage[]): MetaPage | null {
  return pages.find((p) => p.instagram_business_account?.id) ?? pages[0] ?? null;
}

/** The stored Page token, decrypted. No env fallback: it only comes from Connect. */
export function storedPageToken(integration: BrandIntegration | null): string | undefined {
  const v = integration?.config?.pageToken;
  return isEncryptedSecret(v) ? decryptSecret(v) : undefined;
}
