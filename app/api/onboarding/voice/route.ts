import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { checkDailyBudget, checkRateLimit } from "@/lib/ai-guard";
import { getBrandWithIcps, updateBrandVoice, updateOnboardingState } from "@/lib/db/queries";
import { voiceToWrites } from "@/lib/onboarding/proposal";
import { rewriteVoiceSample, writeVoiceSamples } from "@/lib/pipeline/onboarding-voice";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 120;

const SampleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  voice: z.string().trim().min(1).max(600),
  tone: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(1500),
});

const RewriteSchema = z.object({
  sample: SampleSchema,
  ask: z.string().trim().min(1).max(300),
});

async function loadBrand() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const data = await getBrandWithIcps(user.id);
  if (!data) return { error: NextResponse.json({ error: "No brand found" }, { status: 404 }) };
  return { brand: data.brand };
}

/**
 * POST { sample, ask }: rewrites one sample with a nudge or the owner's own
 * words, nothing saved. POST {} writes three fresh samples, for when the
 * research couldn't. Free to the owner, rate limited.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Set ANTHROPIC_API_KEY in .env.local." }, { status: 503 });
  }
  try {
    const loaded = await loadBrand();
    if (loaded.error) return loaded.error;
    const { brand } = loaded;
    const proposal = brand.onboarding_state?.proposal;
    if (!proposal) {
      return NextResponse.json({ error: "Start onboarding from the first step." }, { status: 409 });
    }
    const limited = checkRateLimit(`onboarding-voice:${brand.id}`, 12, 60_000);
    if (!limited.ok) return NextResponse.json({ error: limited.error }, { status: limited.status });
    const budget = await checkDailyBudget();
    if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: budget.status });

    const body = await req.json().catch(() => ({}));
    const rewrite = RewriteSchema.safeParse(body);
    if (rewrite.success) {
      const sample = await rewriteVoiceSample(proposal, rewrite.data.sample, rewrite.data.ask, {
        brandId: brand.id,
      });
      if (!sample) return NextResponse.json({ error: "Couldn't rewrite that one. Try again." }, { status: 502 });
      return NextResponse.json({ sample });
    }

    const samples = await writeVoiceSamples(proposal, { brandId: brand.id });
    if (!samples.length) {
      return NextResponse.json({ error: "Couldn't write samples. Try again." }, { status: 502 });
    }
    await updateOnboardingState(brand.id, {
      ...brand.onboarding_state,
      proposal: { ...proposal, voice_samples: samples },
    });
    return NextResponse.json({ samples });
  } catch (err) {
    logError("api:/api/onboarding/voice:post", err);
    return NextResponse.json({ error: "Couldn't write samples. Try again." }, { status: 500 });
  }
}

/**
 * PUT { sample }: "This is me". Saves the picked voice (with the site's own
 * lines as examples) and marks onboarding complete.
 */
export async function PUT(req: NextRequest) {
  const parsed = z.object({ sample: SampleSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a voice first." }, { status: 400 });
  try {
    const loaded = await loadBrand();
    if (loaded.error) return loaded.error;
    const { brand } = loaded;
    const state = brand.onboarding_state ?? {};
    await updateBrandVoice(
      brand.id,
      voiceToWrites(parsed.data.sample, state.proposal?.example_lines ?? [], brand.voice_profile ?? {}),
    );
    await updateOnboardingState(brand.id, { ...state, step: "ideas", completed: true });
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/onboarding/voice:put", err);
    return NextResponse.json({ error: "Couldn't save your voice. Try again." }, { status: 500 });
  }
}
