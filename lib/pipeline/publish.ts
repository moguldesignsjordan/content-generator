import "server-only";
import {
  getBrandIntegrations,
  getDraftWithJobContext,
  getPublication,
  getBrandByDraftId,
  markJobPublished,
  recordPublication,
} from "@/lib/db/queries";
import type { BrandIntegration } from "@/lib/db/types";
import { getProvider, providersForKind } from "@/lib/publishing/registry";
import type { PublishSchedule } from "@/lib/publishing/provider";

export interface PublishOutcome {
  target: string;
  externalId: string;
  url?: string;
  /** True when this call found an existing publication and did nothing. */
  alreadyPublished: boolean;
  /** 'sent' | 'scheduled' | 'draft'. See PublishResult for what each means. */
  status: string;
  scheduledFor?: string;
  /** Present when status is 'draft' because the provider's send/schedule call failed. */
  scheduleError?: string;
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
 * in state "approved" can publish, ever. Provider credentials resolve from
 * the brand's saved connection with env-var fallback (see lib/publishing/
 * credentials.ts), so a brand with its own API key takes precedence over the
 * shared server env.
 */
export async function publishDraft(
  draftId: string,
  targetId?: string,
  schedule?: PublishSchedule,
): Promise<PublishOutcome> {
  const draft = await getDraftWithJobContext(draftId);
  if (!draft) throw new Error(`Draft ${draftId} not found.`);
  if (draft.state !== "approved") {
    throw new Error("Only approved drafts can be published. Approve it first.");
  }

  // Load the brand and its connections BEFORE provider selection: isConfigured
  // now needs (brand, integration), and the chosen provider's publish() needs
  // the matching integration row. Brand comes from the draft (draft -> job ->
  // brand), not the session, since a draft's owner is intrinsic to it.
  const brand = await getBrandByDraftId(draftId);
  if (!brand) throw new Error("No brand found.");

  const integrations = await getBrandIntegrations(brand.id);
  const integrationFor = (providerId: string): BrandIntegration | null =>
    integrations.find((i) => i.provider_id === providerId) ?? null;

  const provider = targetId
    ? getProvider(targetId)
    : (providersForKind(draft.jobType).find((p) =>
        p.isConfigured(brand, integrationFor(p.id)),
      ) ?? null);
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

  const integration = integrationFor(provider.id);
  if (!provider.isConfigured(brand, integration)) {
    throw new Error(
      `${provider.label} is not configured. Connect it in Settings → Connections.`,
    );
  }

  const existing = await getPublication(draft.jobId, provider.id);
  if (existing?.external_id) {
    return {
      target: provider.id,
      externalId: existing.external_id,
      url: existing.url ?? undefined,
      alreadyPublished: true,
      status: existing.status,
      scheduledFor: existing.scheduled_for ?? undefined,
    };
  }

  const result = await provider.publish({
    jobId: draft.jobId,
    draftId: draft.draftId,
    content: draft.content,
    meta: draft.meta,
    brand,
    integration,
    schedule,
  });

  const row = await recordPublication({
    jobId: draft.jobId,
    target: provider.id,
    externalId: result.externalId,
    url: result.url,
    status: result.status,
    scheduledFor: result.scheduledFor,
  });

  await markJobPublished(draft.jobId, result.url);

  return {
    target: provider.id,
    externalId: row.external_id ?? result.externalId,
    url: row.url ?? result.url,
    alreadyPublished: false,
    status: row.status,
    scheduledFor: row.scheduled_for ?? undefined,
    scheduleError: result.scheduleError,
  };
}
