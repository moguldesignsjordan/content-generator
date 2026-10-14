import { NextRequest, NextResponse } from "next/server";
import {
  deleteDesignLook,
  getDesignLook,
  getSingleBrand,
  updateDesignLook,
} from "@/lib/db/queries";
import { extractLookProfile } from "@/lib/pipeline/extract-look";
import { cleanExamples, cleanLookName, storageHostFromEnv } from "@/lib/looks";
import type { DesignLook } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 120;

async function ownLook(
  id: string,
): Promise<{ error: NextResponse } | { brandId: string; look: DesignLook }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const brand = await getSingleBrand(user.id);
  const look = brand ? await getDesignLook(id, brand.id) : null;
  if (!brand || !look) {
    return { error: NextResponse.json({ error: "Look not found." }, { status: 404 }) };
  }
  return { brandId: brand.id, look };
}

/**
 * PATCH { name?, examples?, is_default? }: renames, swaps examples (re-reads
 * the design), or makes this the brand's default (clearing the old one).
 * is_default: false clears it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const owned = await ownLook(id);
    if ("error" in owned) return owned.error;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Parameters<typeof updateDesignLook>[2] = {};
    if (body.name !== undefined) {
      const name = cleanLookName(body.name);
      if (!name) return NextResponse.json({ error: "Give the look a name." }, { status: 400 });
      patch.name = name;
    }
    if (body.examples !== undefined) {
      const examples = cleanExamples(body.examples, storageHostFromEnv());
      if (!examples) return NextResponse.json({ error: "Keep at least one example image." }, { status: 400 });
      patch.examples = examples;
      patch.profile = await extractLookProfile(examples, owned.brandId);
    }
    if (typeof body.is_default === "boolean") patch.is_default = body.is_default;

    const look = await updateDesignLook(id, owned.brandId, patch);
    return NextResponse.json({ look });
  } catch (err) {
    logError("api:/api/looks/[id]:patch", err);
    return NextResponse.json({ error: "Couldn't update the look." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const owned = await ownLook(id);
    if ("error" in owned) return owned.error;
    await deleteDesignLook(id, owned.brandId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/looks/[id]:delete", err);
    return NextResponse.json({ error: "Couldn't delete the look." }, { status: 500 });
  }
}
