import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  updateBrandBasics,
  updateBrandVoice,
  updateFunnelDefinition,
  updateIcp,
  updateOnboardingState,
  updatePositioning,
  updateVisualIdentity,
  upsertProduct,
} from "@/lib/db/queries";
import { MAIN_ACTION_KINDS, type OnboardingProposal } from "@/lib/db/types";
import { snapshotToWrites } from "@/lib/onboarding/proposal";
import { ownProductPhoto } from "@/lib/scrape/products";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

const text = (max: number) => z.string().trim().max(max).optional();
const list = (max: number, len = 200) => z.array(z.string().trim().min(1).max(len)).max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();

// The owner's confirmed snapshot. Everything in it came from our own research
// route, but it round-trips through the browser, so it's validated here.
const SnapshotSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: text(1000),
  tagline: text(200),
  logo_url: z.url().max(2048).optional(),
  colors: z
    .object({ primary: hex, secondary: hex, accent: hex, background: hex, text: hex, muted: hex })
    .optional(),
  fonts: z.object({ heading: text(200), body: text(200) }).optional(),
  products: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(200),
        description: text(1000),
        deliverables: list(20).optional(),
        price_point: text(120),
        url: text(2048),
        image_url: text(2048),
      }),
    )
    .max(40),
  audience: z.object({
    label: text(200),
    demographics: text(500),
    pains: list(8).optional(),
    objections: list(8).optional(),
    vocabulary: list(8).optional(),
  }),
  differentiators: list(12),
  competitors: list(8),
  main_action: z.object({
    kind: z.enum(MAIN_ACTION_KINDS).optional(),
    wording: text(200),
    url: text(2048),
  }),
  phone: text(40),
  website: text(2048),
  contact_email: text(200),
  social: z
    .object({ linkedin: text(2048), twitter: text(2048), instagram: text(2048), youtube: text(2048) })
    .optional(),
  service_area: text(200),
  postal_address: text(300),
  guarantee: text(300),
  example_lines: list(10, 600),
  site_voice: z.object({ voice: text(600), tone: text(300) }).optional(),
  rating: text(200),
  guesses: list(10),
  sources: z.array(z.object({ url: z.string().max(2048), title: z.string().max(300) })).max(30),
  voice_samples: z
    .array(
      z.object({
        name: z.string().max(60),
        voice: z.string().max(600),
        tone: z.string().max(300),
        text: z.string().max(1500),
        from_site: z.boolean(),
      }),
    )
    .max(3)
    .optional(),
});

/**
 * POST { snapshot }: the owner tapped "Looks good". Writes every confirmed
 * section through the existing queries, merged over what's stored, then
 * moves onboarding to the voice step. The brand comes from the session.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown } | null;
  const parsed = SnapshotSchema.safeParse(body?.snapshot);
  if (!parsed.success) {
    return NextResponse.json({ error: "Something in the profile didn't look right. Check it and try again." }, { status: 400 });
  }
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const current = await getBrandWithIcps(user.id);
    if (!current) return NextResponse.json({ error: "No brand found" }, { status: 404 });

    // Creates the strategy, ICP, starter cluster, and default CTA library on
    // a new brand; re-read after, so the writes merge over what it backfilled.
    const { strategy, primaryIcp } = await ensureStrategyAndPrimaryIcp(current.brand.id);
    const fresh = await getBrandWithIcps(user.id);
    const brand = fresh?.brand ?? current.brand;

    const snapshot = parsed.data as OnboardingProposal;
    const writes = snapshotToWrites(snapshot, { brand, strategy, primaryIcp });

    await updateBrandBasics(brand.id, writes.basics);
    await updatePositioning(brand.id, writes.positioning);
    await updateVisualIdentity(brand.id, writes.visualIdentity);
    if (writes.icp) await updateIcp(writes.icp.id, { label: writes.icp.label, profile: writes.icp.profile });
    if (writes.voiceProfile) await updateBrandVoice(brand.id, writes.voiceProfile);
    if (writes.funnel) await updateFunnelDefinition(strategy.id, writes.funnel);
    for (const product of writes.products) {
      await upsertProduct(brand.id, {
        ...product,
        image_url: await ownProductPhoto(product.image_url),
      });
    }

    await updateOnboardingState(brand.id, {
      ...brand.onboarding_state,
      step: "voice",
      proposal: snapshot,
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/onboarding/save", err);
    return NextResponse.json({ error: "Couldn't save your profile. Try again." }, { status: 500 });
  }
}
