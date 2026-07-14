"use client";

import { useState } from "react";
import type { CreditPack } from "@/lib/billing/credits";
import type { PlanCode } from "@/lib/db/types";
import { Button, Card, StatCard, useToast } from "@/components/ui";

/**
 * The billing shell: balance, plan, buy-credits, manage-subscription. The full
 * dashboard (usage breakdown chart, transaction history table) is a later
 * slice; this is deliberately just enough to spend real money against.
 */
export function BillingClient({
  balance,
  creditsPerUsd,
  packs,
  planCode,
  hasStripeCustomer,
  stripeConfigured,
}: {
  balance: number;
  creditsPerUsd: number;
  packs: CreditPack[];
  planCode: PlanCode;
  hasStripeCustomer: boolean;
  stripeConfigured: boolean;
}) {
  const toast = useToast();
  const [buying, setBuying] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  async function buyPack(packId: string) {
    setBuying(packId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        toast.error(body.error ?? "Couldn't start checkout.");
        setBuying(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      toast.error("Couldn't start checkout. Try again.");
      setBuying(null);
    }
  }

  async function openPortal() {
    setOpeningPortal(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        toast.error(body.error ?? "Couldn't open billing management.");
        setOpeningPortal(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      toast.error("Couldn't open billing management. Try again.");
      setOpeningPortal(false);
    }
  }

  const faceValue = (balance / creditsPerUsd).toFixed(2);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Credits" value={balance.toLocaleString()} sub={`≈ $${faceValue}`} />
        <StatCard
          label="Plan"
          value={planCode === "pro" ? "Pro" : "Free"}
          sub={planCode === "pro" ? "Monthly allowance active" : "Starter + free monthly credits"}
        />
      </div>

      {!stripeConfigured ? (
        <Card className="p-6">
          <h2 className="font-display text-lg font-semibold">Billing isn't set up yet</h2>
          <p className="mt-2 text-sm text-muted">
            Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to .env.local to enable buying
            credits and managing a subscription. Generation still works off your free
            balance until then.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold">Buy credits</h2>
            {packs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No credit packs are configured yet. Add entries to billing_config.packs
                (each needs a Stripe Price id) to offer them here.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {packs.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center justify-between rounded-[var(--radius-card)] border border-border bg-surface-2 p-4"
                  >
                    <div>
                      <div className="font-display text-base font-semibold text-foreground">
                        {pack.credits.toLocaleString()} credits
                      </div>
                      <div className="text-[13px] text-muted">${pack.price_usd.toFixed(2)}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="gradient"
                      loading={buying === pack.id}
                      disabled={buying !== null}
                      onClick={() => buyPack(pack.id)}
                    >
                      Buy
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold">Subscription</h2>
            <p className="mt-2 text-sm text-muted">
              {hasStripeCustomer
                ? "Manage your payment method, invoices, and subscription."
                : "Buy a credit pack first to open billing management."}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              loading={openingPortal}
              disabled={!hasStripeCustomer}
              onClick={openPortal}
            >
              Manage subscription
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
