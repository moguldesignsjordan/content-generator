import { NextRequest, NextResponse } from "next/server";
import { updateBrandBasics } from "@/lib/db/queries";
import type { MailerliteConfig, SeoDefaults } from "@/lib/db/types";

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      brandId: string;
      name: string;
      mailerlite_config: MailerliteConfig;
      seo_defaults: SeoDefaults;
    };

    if (!body.brandId || !body.name?.trim()) {
      return NextResponse.json(
        { error: "brandId and name are required." },
        { status: 400 },
      );
    }

    await updateBrandBasics(body.brandId, {
      name: body.name.trim(),
      mailerlite_config: body.mailerlite_config,
      seo_defaults: body.seo_defaults,
    });

    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("brand-basics update error", err);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}
