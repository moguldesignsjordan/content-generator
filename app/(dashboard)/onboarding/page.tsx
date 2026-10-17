import { redirect } from "next/navigation";
import { getBrandWithIcps, listProducts } from "@/lib/db/queries";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import type { OnboardingState } from "@/lib/db/types";
import { brandReadiness, type ReadinessItem } from "@/lib/brand-readiness";
import { Card, LinkButton } from "@/components/ui";
import { OnboardingFlow, type FlowStep } from "./_components/onboarding-flow";

export const dynamic = "force-dynamic";

/** The setup items "You're set" points at, in this order, when still open. */
const TODO_LABELS = ["Email sender", "Mailing address", "Brand guidelines approved"];

/**
 * Onboarding: the app researches the business (its site and the web), the
 * owner confirms a snapshot, picks a voice from real samples, and leaves
 * with three ideas. With no brand yet, the first submit creates one.
 * Settings remains the edit-later surface.
 */
export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <p className="text-sm text-muted">
          Connect Supabase first, see the dashboard for setup steps.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");

  let data: Awaited<ReturnType<typeof getBrandWithIcps>>;
  try {
    data = await getBrandWithIcps(user.id);
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn&apos;t load onboarding
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  if (!data) {
    return <OnboardingFlow hasBrand={false} initialStep="find" todo={[]} />;
  }

  const { brand, icps } = data;
  const state = brand.onboarding_state ?? {};

  // Finished before this flow existed (no step saved): nothing to resume.
  if (state.completed && !state.step) return <SetUpCard />;

  let todo: ReadinessItem[] = [];
  if (state.step === "ideas") {
    const products = await listProducts(brand.id).catch(() => []);
    const open = brandReadiness(brand, icps, products).items.filter((i) => !i.done);
    todo = TODO_LABELS.flatMap((label) => open.filter((i) => i.label === label));
  }

  return (
    <OnboardingFlow
      hasBrand
      initialStep={resumeStep(state)}
      input={state.input}
      proposal={state.proposal}
      todo={todo}
    />
  );
}

/** Where a reload lands. Mid-research saves step "find", so the owner sees
 * step 1 prefilled and can try again. */
function resumeStep(state: OnboardingState): FlowStep {
  if (state.step === "confirm" || state.step === "voice") return state.proposal ? state.step : "find";
  if (state.step === "ideas") return "ideas";
  return "find";
}

function SetUpCard() {
  return (
    <Card className="p-7 text-center">
      <h1 className="font-display text-lg font-semibold">Your brand profile is set up</h1>
      <p className="mt-2 text-sm text-muted">You can refine anything anytime in Settings.</p>
      <div className="mt-5 flex justify-center gap-3">
        <LinkButton href="/settings" variant="subtle">
          Open Settings
        </LinkButton>
        <LinkButton href="/" variant="gradient">
          Go to dashboard
        </LinkButton>
      </div>
    </Card>
  );
}
