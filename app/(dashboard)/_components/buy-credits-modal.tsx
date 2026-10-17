"use client";

import { useCallback, useEffect, useState } from "react";
import { BUY_CREDITS_EVENT, type BillingSummary } from "@/lib/billing/buy-credits";
import { useCheckout } from "@/lib/billing/use-checkout";
import { Button, LinkButton, Sheet, Spinner } from "@/components/ui";

/** The out-of-credits popup. Mounted once in the dashboard layout and opened by
 *  openBuyCredits() from any failed metered call. */
export function BuyCreditsModal() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { startCheckout, pending } = useCheckout();

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setLoadFailed(false);
      // Refetched on every open: the balance is what changed.
      fetch("/api/billing/summary")
        .then((res) => (res.ok ? (res.json() as Promise<BillingSummary>) : Promise.reject()))
        .then(setSummary)
        .catch(() => setLoadFailed(true));
    };
    window.addEventListener(BUY_CREDITS_EVENT, onOpen);
    return () => window.removeEventListener(BUY_CREDITS_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const canUpgrade = summary?.planCode !== "pro" && summary?.proPlanConfigured;
  const purchasable =
    summary?.stripeConfigured && (summary.packs.length > 0 || canUpgrade);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="You're out of credits"
      description="Top up to keep generating."
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={close}>
            Not now
          </Button>
          <LinkButton href="/billing" variant="outline" onClick={close}>
            View billing
          </LinkButton>
        </div>
      }
    >
      {loadFailed ? (
        <p className="text-sm text-muted">
          We couldn&apos;t load your balance. Open billing to buy credits.
        </p>
      ) : !summary ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} />
        </div>
      ) : !purchasable ? (
        <p className="text-sm text-muted">
          Credits aren&apos;t available to buy online yet. Contact us and we&apos;ll top up
          your account.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Balance: <span className="font-semibold text-foreground">{summary.balance.toLocaleString()}</span>{" "}
            credits
          </p>
          {summary.packs.map((pack) => (
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
                loading={pending === pack.id}
                disabled={pending !== null}
                onClick={() => startCheckout({ packId: pack.id })}
              >
                Buy
              </Button>
            </div>
          ))}
          {canUpgrade && (
            <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-display text-base font-semibold text-foreground">Pro plan</div>
                <div className="text-[13px] text-muted">
                  A bigger monthly allowance, refreshed automatically.
                </div>
              </div>
              <Button
                size="sm"
                variant="gradient"
                loading={pending === "pro"}
                disabled={pending !== null}
                onClick={() => startCheckout({ plan: "pro" })}
                className="shrink-0"
              >
                Upgrade
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
