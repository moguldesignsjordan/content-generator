"use client";

import { useMemo, useState } from "react";
import type { CreditPack } from "@/lib/billing/credits";
import { bucketUsage, humanizeReason, type UsageBreakdownInput } from "@/lib/billing/usage-labels";
import type { PlanCode } from "@/lib/db/types";
import { Button, Card, StatCard, useToast } from "@/components/ui";

// Mirrors lib/db/queries.ts's CreditTransactionRow. Defined locally rather than
// imported so this client component has zero dependency on lib/db/queries.ts,
// which carries a "server-only" import.
interface TransactionRow {
  id: string;
  delta: number;
  reason: string;
  sourceId: string | null;
  usdReference: number | null;
  createdAt: string;
}

/** The billing shell: balance, plan, buy-credits, upgrade/manage subscription,
 *  this month's usage by type, and the credit ledger. */
export function BillingClient({
  balance,
  creditsPerUsd,
  packs,
  planCode,
  hasStripeCustomer,
  stripeConfigured,
  proPlanConfigured,
  usage,
  transactions,
}: {
  balance: number;
  creditsPerUsd: number;
  packs: CreditPack[];
  planCode: PlanCode;
  hasStripeCustomer: boolean;
  stripeConfigured: boolean;
  proPlanConfigured: boolean;
  usage: UsageBreakdownInput[];
  transactions: TransactionRow[];
}) {
  const toast = useToast();
  const [buying, setBuying] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  async function checkout(body: { packId: string } | { plan: "pro" }) {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? "Couldn't start checkout.");
    }
    window.location.href = data.url;
  }

  async function buyPack(packId: string) {
    setBuying(packId);
    try {
      await checkout({ packId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start checkout.");
      setBuying(null);
    }
  }

  async function upgradeToPro() {
    setUpgrading(true);
    try {
      await checkout({ plan: "pro" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start checkout.");
      setUpgrading(false);
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
  const buckets = useMemo(() => bucketUsage(usage), [usage]);

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
                      disabled={buying !== null || upgrading}
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
            <h2 className="font-display text-lg font-semibold">Plan</h2>
            {planCode === "pro" ? (
              <p className="mt-2 text-sm text-muted">
                You're on the Pro plan: a bigger monthly credit allowance, refreshed
                automatically. Manage or cancel it below.
              </p>
            ) : proPlanConfigured ? (
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  Upgrade to Pro for a larger monthly credit allowance instead of buying
                  packs one at a time.
                </p>
                <Button
                  variant="gradient"
                  size="sm"
                  loading={upgrading}
                  disabled={buying !== null || upgrading}
                  onClick={upgradeToPro}
                  className="shrink-0"
                >
                  Upgrade to Pro
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                The Pro plan isn't configured yet. Set STRIPE_PRO_PRICE_ID to enable it.
              </p>
            )}
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm text-muted">
                {hasStripeCustomer
                  ? "Manage your payment method, invoices, and subscription."
                  : "Buy a credit pack or upgrade first to open billing management."}
              </p>
              <Button
                variant="outline"
                className="mt-3"
                loading={openingPortal}
                disabled={!hasStripeCustomer}
                onClick={openPortal}
              >
                Manage subscription
              </Button>
            </div>
          </Card>
        </>
      )}

      <UsageChart buckets={buckets} />
      <TransactionHistory transactions={transactions} />
    </div>
  );
}

function UsageChart({ buckets }: { buckets: ReturnType<typeof bucketUsage> }) {
  const max = Math.max(0, ...buckets.map((b) => b.estimatedUsd));

  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-semibold">Usage this month</h2>
      <p className="mt-1 text-[13px] text-muted">Real AI cost by action type, before markup.</p>
      {buckets.length === 0 || max === 0 ? (
        <p className="mt-4 text-sm text-muted">No AI usage recorded yet this month.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {buckets.map((bucket) => (
            <div key={bucket.label}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium text-foreground">{bucket.label}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  ${bucket.estimatedUsd.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 h-5 w-full overflow-hidden rounded-[4px] bg-surface-2">
                <div
                  className="h-full rounded-r-[4px] bg-[var(--cyan)]"
                  style={{ width: `${Math.max(2, (bucket.estimatedUsd / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TransactionHistory({ transactions }: { transactions: TransactionRow[] }) {
  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-semibold">Transaction history</h2>
      {transactions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No credit activity yet.</p>
      ) : (
        <div className="mt-4 -mx-2 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-2 pb-2 font-medium">Date</th>
                <th className="px-2 pb-2 font-medium">Type</th>
                <th className="px-2 pb-2 text-right font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-2 py-2 text-muted">
                    {new Date(tx.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-2 py-2 text-foreground">{humanizeReason(tx.reason)}</td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums font-medium ${
                      tx.delta > 0 ? "text-success" : "text-foreground"
                    }`}
                  >
                    {tx.delta > 0 ? "+" : ""}
                    {tx.delta.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
