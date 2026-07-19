import { NextResponse } from "next/server";
import { getDraftForReview, getSingleBrand } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

// Streams the approved flyer back as an attachment. A route (not a plain
// <a download>) because the image lives on the Supabase Storage origin and
// browsers ignore the download attribute cross-origin. Approval is the v1
// "publish" gate: nothing exports before a human approves it.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return NextResponse.json({ error: "No brand found." }, { status: 404 });
  }

  const draft = await getDraftForReview(id, brand.id);
  if (!draft || draft.job_type !== "social") {
    return NextResponse.json({ error: "Flyer not found." }, { status: 404 });
  }
  if (draft.state !== "approved") {
    return NextResponse.json(
      { error: "Approve this flyer before downloading it." },
      { status: 409 },
    );
  }
  const image = draft.meta.flyer_image;
  if (!image?.url) {
    return NextResponse.json({ error: "This draft has no flyer image." }, { status: 404 });
  }

  try {
    const res = await fetch(image.url);
    if (!res.ok) throw new Error(`Storage fetch failed (${res.status}).`);
    const data = await res.arrayBuffer();

    const slug = (draft.topic_title ?? draft.content.subject ?? "flyer")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    return new Response(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${slug || "flyer"}-${id.slice(0, 8)}.jpg"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("api:/api/drafts/[id]/flyer/download", err, { draftId: id });
    return NextResponse.json(
      { error: "Couldn't fetch the flyer image. Try again." },
      { status: 502 },
    );
  }
}
