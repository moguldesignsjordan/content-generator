import "server-only";
import { createClient, type SanityClient } from "@sanity/client";

// Server-only Sanity client, mirroring the lazy-singleton +
// isConfigured() shape of lib/clients/anthropic.ts. Env comes from
// .env.local (SANITY_PROJECT_ID / SANITY_DATASET / SANITY_WRITE_TOKEN);
// nothing here can reach the client bundle.

const API_VERSION = process.env.SANITY_API_VERSION ?? "2025-02-19";

/** The Sanity document type blog posts are written as. Override per studio schema. */
export const SANITY_POST_TYPE = process.env.SANITY_POST_TYPE ?? "post";

export function isSanityConfigured(): boolean {
  return Boolean(
    process.env.SANITY_PROJECT_ID &&
      process.env.SANITY_DATASET &&
      process.env.SANITY_WRITE_TOKEN,
  );
}

let client: SanityClient | null = null;

export function getSanity(): SanityClient {
  if (!isSanityConfigured()) {
    throw new Error(
      "Sanity is not configured. Set SANITY_PROJECT_ID, SANITY_DATASET, and SANITY_WRITE_TOKEN in .env.local.",
    );
  }
  if (!client) {
    client = createClient({
      projectId: process.env.SANITY_PROJECT_ID!,
      dataset: process.env.SANITY_DATASET!,
      token: process.env.SANITY_WRITE_TOKEN!,
      apiVersion: API_VERSION,
      useCdn: false, // writes + read-after-write need the live API
    });
  }
  return client;
}
