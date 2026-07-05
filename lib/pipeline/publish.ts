import "server-only";
import {
  getDraftWithJobContext,
  getPublication,
  getSingleBrand,
  markJobPublished,
  recordPublication,
} from "@/lib/db/queries";
import { getProvider, providersForKind } from "@/lib/publishing/registry";

export interface PublishOutcome {
  target: string;
  externalId: string;
  url?: string;
  /** True when this call found an existing publication and did nothing. */
  alreadyPublished: boolean;
}

/**
 * Publishes an approved draft through the provider registry. Provider-agnostic
 * by design: resolve the draft's channel → the configured provider of that
 * kind (or an explicit target id) → adapter.publish → record the publication.
 *
 * Idempotent at the pipeline level: an existing publications row for
 * (job, target) short-circuits BEFORE any external call, and recordPublication
 * tolerates the raced-insert case, so a retry never double-posts.
 *
 * The human-approval gate is enforced here, not just in the UI: only drafts
 * in state "approved" can publish, ever.
 */
export async function publishDraft(
  draftId: string,
  targetId?: string,
): Promise<PublishOutcome> {
  const draft = await getDraftWithJobContext(draftId);
  if (!draft) throw new Error(`Draft ${draftId} not found.`);
  if (draft.state !== "approved") {
    throw new Error("Only approved drafts can be published. Approve it first.");
  }

  const provider = targetId
    ? getProvider(targetId)
    : (providersForKind(draft.jobType).find((p) => p.isConfigured()) ?? null);
  if (!provider) {
    throw new Error(
      targetId
        ? `Unknown publishing destination "${targetId}".`
        : `No configured destination can publish ${draft.jobType} drafts. Connect one in Settings.`,
    );
  }
  if (provider.kind !== draft.jobType) {
    throw new Error(
      `${provider.label} publishes ${provider.kind} drafts, not ${draft.jobType}.`,
    );
  }
  if (!provider.isConfigured()) {
    throw new Error(`${provider.label} is not configured. ${provider.configHint}`);
  }

  const existing = await getPublication(draft.jobId, provider.id);
  if (existing?.external_id) {
    return {
      target: provider.id,
      externalId: existing.external_id,
      url: existing.url ?? undefined,
      alreadyPublished: true,
    };
  }

  const brand = await getSingleBrand();
  if (!brand) throw new Error("No brand found.");

  const result = await provider.publish({
    jobId: draft.jobId,
    draftId: draft.draftId,
    content: draft.content,
    meta: draft.meta,
    brand,
  });

  const row = await recordPublication({
    jobId: draft.jobId,
    target: provider.id,
    externalId: result.externalId,
    url: result.url,
  });

  await markJobPublished(draft.jobId, result.url);

  return {
    target: provider.id,
    externalId: row.external_id ?? result.externalId,
    url: row.url ?? result.url,
    alreadyPublished: false,
  };
}
