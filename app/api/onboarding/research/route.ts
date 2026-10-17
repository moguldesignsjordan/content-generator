import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { checkDailyBudget, checkRateLimit } from "@/lib/ai-guard";
import { getBrandWithIcps, updateOnboardingState } from "@/lib/db/queries";
import type { OnboardingInput, OnboardingProposal } from "@/lib/db/types";
import { importWebsite, type WebsiteImport } from "@/lib/pipeline/import-website";
import { researchBusiness } from "@/lib/pipeline/research-business";
import { generateBrandIdentity } from "@/lib/pipeline/brand-identity";
import { writeVoiceSamples } from "@/lib/pipeline/onboarding-voice";
import { buildProposal, provisionalName, type BusinessResearch } from "@/lib/onboarding/proposal";
import { ScrapeError } from "@/lib/scrape";
import { logError, logWarn } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Site scrape + extraction (30-70s) runs alongside the web research (75s
// budget), then the voice samples (~10s).
export const maxDuration = 300;

const BodySchema = z.union([
  z.object({ url: z.string().trim().min(4).max(2048) }),
  z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    city: z.string().trim().max(120).optional(),
  }),
]);

type StepStatus = "running" | "done" | "skipped" | "failed";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * POST { url } or { name, description, city }: researches the business and
 * streams honest progress (`step` events), then `done { proposal }`. Nothing
 * is written to the brand profile here; the proposal is kept on
 * onboarding_state so a reload resumes at the snapshot. A failed step never
 * blocks: the flow carries on with what the other sources found.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Set ANTHROPIC_API_KEY in .env.local." }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your website, or your name and what you do." },
      { status: 400 },
    );
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const data = await getBrandWithIcps(user.id);
  if (!data) return NextResponse.json({ error: "No brand found" }, { status: 404 });
  const { brand } = data;

  // Free to the owner (no credit check, so a failed starter grant can't
  // block onboarding), but rate limited and under the house daily cap.
  const limited = checkRateLimit(`onboarding-research:${brand.id}`, 4, 10 * 60_000);
  if (!limited.ok) return NextResponse.json({ error: limited.error }, { status: limited.status });
  const budget = await checkDailyBudget();
  if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: budget.status });

  const input: OnboardingInput = parsed.data;
  const state = brand.onboarding_state ?? {};
  const brandId = brand.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // The client went away; the research still finishes and saves.
        }
      };
      const step = (id: string, status: StepStatus, label: string, detail?: string) =>
        send("step", { id, status, label, ...(detail ? { detail } : {}) });

      try {
        // Saved first, so a reload mid-research lands on step 1 prefilled.
        await updateOnboardingState(brandId, { ...state, step: "find", input });

        let sitePromise: Promise<WebsiteImport | null> = Promise.resolve(null);
        if (input.url) {
          step("site", "running", "Reading your site");
          sitePromise = importWebsite(input.url, {
            brandId,
            brandName: provisionalName(input),
            onScraped: (pages) => {
              step("site", "done", "Read your site", plural(pages, "page", "pages"));
              step("services", "running", "Finding what you sell");
              step("brand", "running", "Finding your logo and colors");
            },
          })
            .then((site) => {
              const products = site.proposal.products?.length ?? 0;
              step(
                "services",
                products ? "done" : "skipped",
                products ? "Found what you sell" : "No services listed on the site",
                products ? plural(products, "item", "items") : undefined,
              );
              const vi = site.proposal.visual_identity;
              step(
                "brand",
                vi?.logo_url || vi?.colors ? "done" : "skipped",
                vi?.logo_url ? "Found your logo and colors" : vi?.colors ? "Found your colors" : "No logo or colors found",
              );
              return site;
            })
            .catch((err) => {
              logWarn("api:/api/onboarding/research:site", err instanceof Error ? err.message : String(err));
              step(
                "site",
                "failed",
                err instanceof ScrapeError && err.code === "no_text"
                  ? "Couldn't read your site's text"
                  : "Couldn't read your site",
              );
              return null;
            });
        } else {
          step("site", "skipped", "No website, starting from your description");
        }

        step("reviews", "running", "Looking up reviews and listings");
        step("competitors", "running", "Looking for competitors nearby");
        const researchPromise: Promise<BusinessResearch | null> = researchBusiness(input, { brandId })
          .then((research) => {
            const found = research.praise.length || research.rating || research.phone || research.postal_address;
            step(
              "reviews",
              found ? "done" : "skipped",
              found ? "Found reviews and listings" : "Couldn't find reviews",
              research.rating,
            );
            step(
              "competitors",
              research.competitors.length ? "done" : "skipped",
              research.competitors.length ? "Found competitors nearby" : "No competitors found",
              research.competitors.length ? plural(research.competitors.length, "business", "businesses") : undefined,
            );
            return research;
          })
          .catch((err) => {
            logWarn("api:/api/onboarding/research:web", err instanceof Error ? err.message : String(err));
            step("reviews", "failed", "Couldn't find reviews");
            step("competitors", "failed", "Couldn't look up competitors");
            return null;
          });

        const [site, research] = await Promise.all([sitePromise, researchPromise]);
        let proposal: OnboardingProposal = buildProposal({ site, research, input });

        // No site colors (no website, or it couldn't be read): a starting
        // palette instead of generic defaults in every email.
        if (!proposal.colors) {
          step("brand", "running", "Picking a starting palette");
          const generated = await generateBrandIdentity({
            brandName: proposal.name,
            positioning: { business_description: proposal.description },
          }).catch(() => null);
          if (generated) {
            proposal = { ...proposal, colors: generated.colors, fonts: proposal.fonts ?? generated.fonts };
            step("brand", "done", "Picked a starting palette", "change it anytime");
          } else {
            step("brand", "skipped", "No palette yet, add your colors later");
          }
        }

        step("voice", "running", "Writing samples in your voice");
        const samples = await writeVoiceSamples(proposal, { brandId }).catch((err) => {
          logWarn("api:/api/onboarding/research:voice", err instanceof Error ? err.message : String(err));
          return [];
        });
        step(
          "voice",
          samples.length ? "done" : "failed",
          samples.length ? "Wrote samples in your voice" : "Couldn't write voice samples",
        );
        proposal = { ...proposal, voice_samples: samples };

        await updateOnboardingState(brandId, { ...state, step: "confirm", input, proposal });
        send("done", { proposal });
      } catch (err) {
        logError("api:/api/onboarding/research", err);
        send("error", { message: "Research hit a snag. Try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
