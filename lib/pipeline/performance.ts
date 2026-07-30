import "server-only";
import {
  getBrandIntegration,
  getLatestPerformance,
  getPublicationForDraft,
  getBrandByDraftId,
  recordPerformance,
} from "@/lib/db/queries";
import type { Brand, PerformanceMetric, PublicationRecord } from "@/lib/db/types";
import { getProvider } from "@/lib/publishing/registry";

/**
 * How stale a snapshot has to be before a webhook is allowed to trigger a new
 * fetch. Open/click events arrive in batches during a send and would otherwise
 * hammer the destination's API for numbers that barely moved.
 */
export const STATS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

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

  const brand = await getBrandByDraftId(draftId);
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

/**
 * The webhook entry point: same fetch-and-append as refreshPerformance, but
 * driven by a publication we already resolved (a webhook knows the campaign,
 * not the draft) and skippable when the last snapshot is still fresh.
 *
 * Deliberately fetch-then-store rather than incrementing counters from the
 * event payload: batched open/click deliveries are deltas that can arrive out
 * of order or be dropped, so the destination's own totals stay the single
 * source of truth and no reconciliation drift is possible.
 *
 * Returns whether it actually fetched. Never throws — a stats refresh failing
 * must not make us return non-2xx and put the provider into retry.
 */
export async function refreshPerformanceForPublication(
  publication: PublicationRecord,
  brand: Brand,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (!publication.external_id) return false;
  const provider = getProvider(publication.target);
  if (!provider?.fetchStats) return false;

  if (!options.force) {
    const latest = await getLatestPerformance(publication.id);
    const newest = latest.reduce<number>((max, row) => {
      const t = Date.parse(row.fetched_at);
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);
    if (newest && Date.now() - newest < STATS_REFRESH_INTERVAL_MS) return false;
  }

  const integration = await getBrandIntegration(brand.id, provider.id).catch(
    () => null,
  );
  if (!provider.isConfigured(brand, integration)) return false;

  const metrics = await provider.fetchStats({
    externalId: publication.external_id,
    brand,
    integration,
  });
  await recordPerformance(publication.id, metrics);
  return true;
}

/** The last-fetched snapshot, without hitting the destination again. */
export async function getPerformanceForDraft(
  draftId: string,
): Promise<PerformanceMetric[]> {
  const publication = await getPublicationForDraft(draftId);
  if (!publication) return [];
  return getLatestPerformance(publication.id);
}
