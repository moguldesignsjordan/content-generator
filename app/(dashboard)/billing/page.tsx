import { redirect } from "next/navigation";
import { getBalance, getBillingConfig } from "@/lib/billing/credits";
import { isStripeConfigured } from "@/lib/clients/stripe";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandBilling, getBrandForUser } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { BillingClient } from "./_components/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to manage billing.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const brand = await getBrandForUser(user.id);
  if (!brand) {
    return (
      <Card className="p-7 text-center">
        <h1 className="font-display text-xl font-semibold">No brand yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Run onboarding first, credits and plan attach to your brand.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  const [balance, config, billing] = await Promise.all([
    getBalance(brand.id),
    getBillingConfig(),
    getBrandBilling(brand.id),
  ]);

  return (
    <>
      <ScreenHeader title="Billing" subtitle={`${brand.name} · credits and plan`} />
      <BillingClient
        balance={balance}
        creditsPerUsd={config.creditsPerUsd}
        packs={config.packs}
        planCode={billing?.plan_code ?? "free"}
        hasStripeCustomer={Boolean(billing?.stripe_customer_id)}
        stripeConfigured={isStripeConfigured()}
      />
    </>
  );
}
