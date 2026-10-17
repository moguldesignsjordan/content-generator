import "server-only";
import { getDraftWithJobContext, getLatestDraftIdForJob } from "@/lib/db/queries";
import type { ChatPreviewRef } from "@/lib/db/types";

// What the Create chat's model is told about the piece previewed in the
// thread, read fresh each turn so a revision made on the card shows up.

/** The piece the chat is previewing, resolved to its newest version. */
export interface OnScreen {
  draftId: string;
  channel: ChatPreviewRef["channel"];
  ready: boolean;
  editable: boolean;
  optionCount: number;
  /** What the model reads at the top of the latest message. */
  line: string;
}

export async function loadOnScreen(ref: ChatPreviewRef | undefined, brandId: string): Promise<OnScreen | null> {
  if (!ref) return null;
  const first = await getDraftWithJobContext(ref.draft_id, brandId);
  if (!first) return null;
  const latestId = (await getLatestDraftIdForJob(first.jobId)) ?? ref.draft_id;
  const draft = latestId === ref.draft_id ? first : await getDraftWithJobContext(latestId, brandId);
  if (!draft) return null;

  const { meta, content } = draft;
  const ready = meta.generation ? meta.generation.status === "ready" : Boolean(content.html || meta.flyer_image);
  const editable = draft.state === "in_review";
  const optionCount = meta.flyer_variants?.length ?? 0;
  let what: string;
  if (ref.channel === "social") {
    const copy = meta.flyer_copy;
    const showing =
      optionCount > 1
        ? meta.flyer_variant_index === undefined
          ? `, ${optionCount} options plus a custom edit (showing the edit)`
          : `, ${optionCount} options (showing option ${meta.flyer_variant_index + 1})`
        : "";
    const text = copy
      ? `. Its text: headline "${copy.headline}"${copy.subtext ? `, supporting line "${copy.subtext}"` : ""}`
      : "";
    what = `a flyer${showing}${text}`;
  } else {
    what = `${ref.channel === "blog" ? "a blog post" : "an email"}, "${content.subject}"`;
  }
  const status = !ready
    ? "Still generating."
    : editable
      ? "Ready."
      : `It's ${draft.state}, so it can't change here; offer to make a new one.`;
  return {
    draftId: latestId,
    channel: ref.channel,
    ready,
    editable,
    optionCount,
    line: `ON SCREEN (live preview under this chat): ${what}. ${status}`,
  };
}
