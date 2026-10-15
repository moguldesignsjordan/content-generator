import { NextResponse } from "next/server";
import { getDraftWithJobContext, getLatestDraftIdForJob } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { DEFAULT_FLYER_ASPECT } from "@/prompts/generate-flyer";
import { logError } from "@/lib/log";

/**
 * GET: what the Create chat's preview card shows for a piece. Resolves to the
 * newest version of the draft's job, so after a revise the card follows the
 * new draft without the chat having to track version ids.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;

    const latestId = (await getLatestDraftIdForJob(access.draft.jobId)) ?? id;
    const draft =
      latestId === id ? access.draft : await getDraftWithJobContext(latestId, access.brandId);
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

    const { meta, content } = draft;
    const generation = meta.generation;
    const ready = generation ? generation.status === "ready" : Boolean(content.html || meta.flyer_image);

    return NextResponse.json({
      id: latestId,
      kind: draft.jobType,
      state: draft.state,
      ready,
      subject: content.subject ?? "",
      ...(draft.jobType === "social"
        ? {
            flyer: {
              image: meta.flyer_image ?? null,
              variants: (meta.flyer_variants ?? []).map((v) => ({ url: v.image.url, headline: v.copy.headline })),
              index: meta.flyer_variant_index ?? null,
              aspect: meta.flyer_aspect ?? DEFAULT_FLYER_ASPECT,
            },
          }
        : { html: content.html ?? "" }),
    });
  } catch (err) {
    logError("api:/api/drafts/[id]/preview", err);
    return NextResponse.json({ error: "Couldn't load the preview." }, { status: 500 });
  }
}
