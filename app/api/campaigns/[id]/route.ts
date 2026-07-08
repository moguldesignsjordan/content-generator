import { NextResponse } from "next/server";
import {
  deleteCampaign,
  getCampaign,
  getCampaignPublishProgress,
} from "@/lib/db/queries";

/**
 * Hard-deletes a campaign. Blocked (409) once any of its emails has sent or
 * been scheduled through MailerLite: the campaign record is the only place
 * that history is grouped, so deleting it out from under a real send would
 * orphan that history. The emails/drafts themselves are never deleted here
 * (content_jobs.campaign_id is on delete set null); this only removes the
 * campaign row and its chat thread.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const progress = await getCampaignPublishProgress([id]);
  const sent = progress.get(id)?.sent ?? 0;
  const scheduled = progress.get(id)?.scheduled ?? 0;
  if (sent > 0 || scheduled > 0) {
    return NextResponse.json(
      {
        error:
          "This campaign has emails that were sent or scheduled, so it can't be deleted.",
      },
      { status: 409 },
    );
  }

  try {
    await deleteCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete campaign." },
      { status: 500 },
    );
  }
}
