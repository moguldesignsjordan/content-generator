import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createReferenceEmail,
  getSingleBrand,
  listReferenceEmails,
} from "@/lib/db/queries";
import { extractEmailStyle } from "@/lib/pipeline/extract-style";
import { emailHtmlToText } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// The reference email library (reference_emails, migration 015): paste or
// upload a full email you want yours to read like; Claude distills its style
// once here, and every email generation injects the result (see
// buildReferenceEmailsBlock). One Claude call per upload, so maxDuration
// covers it.
export const maxDuration = 60;

const MAX_CONTENT_CHARS = 40000;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ references: [] });
  }
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ references: [] });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ references: [] });
    const references = await listReferenceEmails(brand.id);
    return NextResponse.json({ references });
  } catch (err) {
    logError("api:/api/reference-emails:list", err);
    return NextResponse.json(
      { error: "Couldn't load reference emails." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json()) as { name?: string; content?: string };
    const name = (body.name ?? "").trim();
    const raw = (body.content ?? "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "Give the reference a name." },
        { status: 400 },
      );
    }
    if (!raw) {
      return NextResponse.json(
        { error: "Paste the email's text first." },
        { status: 400 },
      );
    }

    const content = emailHtmlToText(raw).slice(0, MAX_CONTENT_CHARS);
    if (content.length < 100) {
      return NextResponse.json(
        { error: "That's too short to learn a style from. Paste the full email." },
        { status: 400 },
      );
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    // Distill the style once, now; null (extraction hiccup) still saves the
    // raw email, which is a usable reference on its own.
    const styleProfile = await extractEmailStyle(content);

    const reference = await createReferenceEmail({
      brandId: brand.id,
      name,
      content,
      styleProfile,
    });
    return NextResponse.json({ reference });
  } catch (err) {
    logError("api:/api/reference-emails:create", err);
    return NextResponse.json(
      { error: "Couldn't save the reference email." },
      { status: 500 },
    );
  }
}
