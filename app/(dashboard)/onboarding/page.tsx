import Link from "next/link";
import { getBrandWithIcps } from "@/lib/db/queries";
import { isSupabaseConfigured } from "@/lib/db/client";
import { Card } from "@/components/ui";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../_components/screen-header";
import { Chat } from "./_components/chat";
import { CreateBrandForm } from "./_components/create-brand-form";

export const dynamic = "force-dynamic";

/**
 * Onboarding is the front door for building a brand profile: a conversational
 * AI strategist that interviews the business and writes the profile from the
 * answers. If no brand exists yet (first run), the first step creates one.
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

  let data: Awaited<ReturnType<typeof getBrandWithIcps>>;
  try {
    data = await getBrandWithIcps();
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load onboarding
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  if (!data) {
    return (
      <>
        <ScreenHeader
          title="Onboarding"
          subtitle="Build the brand brain your content engine generates from."
        />
        <CreateBrandForm />
      </>
    );
  }

  const { brand } = data;
  const state = brand.onboarding_state ?? {};

  return (
    <>
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> Dashboard
      </Link>
      <ScreenHeader
        title={brand.name}
        subtitle="Chat with the strategist to build your brand brain. Everything saves as you go, and you can tweak it later in Settings."
      />
      <Chat
        brandId={brand.id}
        initialMessages={state.messages ?? []}
        alreadyComplete={state.completed === true}
      />
    </>
  );
}
