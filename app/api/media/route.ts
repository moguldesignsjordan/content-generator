import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSingleBrand, listMediaAssets } from "@/lib/db/queries";
import type { MediaAssetKind } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// The media library (migration 024): every image the app has hosted, so it
// can be browsed and reused without a fresh generation. See media_assets and
// lib/db/queries.ts listMediaAssets/createMediaAsset/deleteMediaAsset.

const KINDS: MediaAssetKind[] = ["hero", "flyer", "product", "general"];

function parseKind(value: string | null): MediaAssetKind | undefined {
  return KINDS.includes(value as MediaAssetKind) ? (value as MediaAssetKind) : undefined;
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ assets: [] });
  }
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ assets: [] });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ assets: [] });
    const kind = parseKind(req.nextUrl.searchParams.get("kind"));
    const assets = await listMediaAssets(brand.id, kind);
    return NextResponse.json({ assets });
  } catch (err) {
    logError("api:/api/media:list", err);
    return NextResponse.json({ error: "Couldn't load your media." }, { status: 500 });
  }
}
