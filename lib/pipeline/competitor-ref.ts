import "server-only";
import { getCompetitorReference } from "@/lib/db/queries";
import type { CompetitorReference } from "@/lib/db/types";
import { logWarn } from "@/lib/log";

/**
 * The competitor ad a piece learns from (its inputs' first one), scoped to
 * the piece's own brand since an id can arrive from the client. Non-fatal: a
 * stale or foreign id, a pre-025 DB, or a read failure all just mean no
 * reference, never a broken generation.
 */
export async function loadCompetitorRef(
  id: string | undefined,
  brandId: string,
  draftId?: string,
): Promise<CompetitorReference | null> {
  if (!id) return null;
  try {
    const ref = await getCompetitorReference(id);
    return ref?.brand_id === brandId ? ref : null;
  } catch (err) {
    logWarn("pipeline:competitor-ref", String(err), { id, ...(draftId ? { draftId } : {}) });
    return null;
  }
}
