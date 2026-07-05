import "server-only";
import { createClient, type SanityClient } from "@sanity/client";
import { resolvePlain, resolveSecret } from "@/lib/publishing/credentials";
import type { BrandIntegration } from "@/lib/db/types";

// Server-only Sanity client. Credentials resolve from the brand's connection
// (lib/db brand_integrations row, write-token stored encrypted) with env-var
// fallback for every field; nothing here can reach the client bundle.

const API_VERSION = process.env.SANITY_API_VERSION ?? "2025-02-19";

export interface SanityConfig {
  projectId: string;
  dataset: string;
  token: string;
  postType: string;
}

/**
 * Resolves a usable Sanity config from the brand's connection with env-var
 * fallback for every field. Returns null when the required pieces (projectId
 * + write token) aren't available from either source, so callers can treat
 * null as "not configured".
 */
export function resolveSanityConfig(
  integration: BrandIntegration | null,
): SanityConfig | null {
  const projectId = resolvePlain<string>(
    integration,
    "projectId",
    process.env.SANITY_PROJECT_ID,
  );
  const dataset =
    resolvePlain<string>(integration, "dataset", process.env.SANITY_DATASET) ??
    "production";
  const token = resolveSecret(integration, "writeToken", "SANITY_WRITE_TOKEN");
  const postType =
    resolvePlain<string>(integration, "postType", process.env.SANITY_POST_TYPE) ??
    "post";
  if (!projectId || !token) return null;
  return { projectId, dataset, token, postType };
}

/** A fresh client per call. Publishing isn't a hot path, so no cache is needed. */
export function getSanity(config: SanityConfig): SanityClient {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    token: config.token,
    apiVersion: API_VERSION,
    useCdn: false, // writes + read-after-write need the live API
  });
}
