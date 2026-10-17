"use client";

import { useState } from "react";
import { useToast } from "@/components/ui";

export type CheckoutRequest = { packId: string } | { plan: "pro" };

/**
 * Starts a Stripe Checkout redirect for a credit pack or the Pro plan. Shared
 * by the billing page and the buy-credits popup. `pending` is the pack id (or
 * "pro") being started, so a caller can spin that one button and disable the
 * rest; it stays set on success because the page is navigating away.
 */
export function useCheckout() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function startCheckout(body: CheckoutRequest) {
    setPending("packId" in body ? body.packId : "pro");
    try {
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start checkout.");
      setPending(null);
    }
  }

  return { startCheckout, pending };
}
