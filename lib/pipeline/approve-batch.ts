import "server-only";
import { approveDraft, getDraftWithJobContext } from "@/lib/db/queries";
import { findBannedTerms } from "@/lib/email/quality";

/**
 * Approves every listed draft that's finished and still waiting for review.
 * The click that calls this is the batch's human approval: each draft gets
 * the same approvals row a single Approve writes. Drafts still generating,
 * already decided, or from another brand are skipped. One that still uses a
 * banned term is skipped too and reported, so it gets fixed on its own review
 * screen instead of shipping (the same gate the single Approve route has).
 */
export async function approveReadyDrafts(
  brandId: string,
  draftIds: string[],
  bannedTerms: string[],
): Promise<{ approved: number; needsLook: string[] }> {
  let approved = 0;
  const needsLook: string[] = [];
  for (const draftId of draftIds) {
    const draft = await getDraftWithJobContext(draftId, brandId);
    if (!draft || draft.state !== "in_review") continue;
    if (draft.meta.generation && draft.meta.generation.status !== "ready") continue;
    const html = draft.content?.html ?? "";
    if (bannedTerms.length && html && findBannedTerms(html, bannedTerms).length) {
      needsLook.push(draftId);
      continue;
    }
    await approveDraft(draftId);
    approved++;
  }
  return { approved, needsLook };
}
