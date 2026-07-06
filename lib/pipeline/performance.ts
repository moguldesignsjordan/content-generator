import "server-only";
import {
  getBrandIntegration,
  getLatestPerformance,
  getPublicationForDraft,
  getSingleBrand,
  recordPerformance,
} from "@/lib/db/queries";
import type { PerformanceMetric } from "@/lib/db/types";
import { getProvider } from "@/lib/publishing/registry";

// Plan 2, the analytics loop: closes strategy → content → publish → measure
// → better topics. Mirrors lib/pipeline/publish.ts's resolution shape
// (publication → provider → brand/integration), one step further downstream.

/**
 * Re-fetches performance from the destination and appends a new snapshot.
 * Throws a clear, user-facing message (mirrors publishDraft) when the draft
 * was never published, or its provider has no reporting concept yet.
 */
export async function refreshPerformance(
  draftId: string,
): Promise<PerformanceMetric[]> {
  const publication = await getPublicationForDraft(draftId);
  if (!publication?.external_id) {
    throw new Error("This draft hasn't been published yet.");
  }

  const provider = getProvider(publication.target);
  if (!provider?.fetchStats) {
    throw new Error(
      `${publication.target} doesn't support performance stats yet.`,
    );
  }

  const brand = await getSingleBrand();
  if (!brand) throw new Error("No brand found.");
  const integration = await getBrandIntegration(brand.id, provider.id).catch(
    () => null,
  );
  if (!provider.isConfigured(brand, integration)) {
    throw new Error(
      `${provider.label} is not configured. Connect it in Settings → Connections.`,
    );
  }

  const metrics = await provider.fetchStats({
    externalId: publication.external_id,
    brand,
    integration,
  });
  await recordPerformance(publication.id, metrics);
  return metrics;
}

/** The last-fetched snapshot, without hitting the destination again. */
export async function getPerformanceForDraft(
  draftId: string,
): Promise<PerformanceMetric[]> {
  const publication = await getPublicationForDraft(draftId);
  if (!publication) return [];
  return getLatestPerformance(publication.id);
}
