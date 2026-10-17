import type { CreditPack } from "@/lib/billing/credits";
import type { PlanCode } from "@/lib/db/types";

// A window event rather than a context: the out-of-credits branches live in
// plain catch blocks and helpers (toastApiError, useGenerationStream) all over
// the dashboard, and an event reaches the one mounted BuyCreditsModal from any
// of them without threading a hook through each.
export const BUY_CREDITS_EVENT = "mogul:buy-credits";

/** Opens the buy-credits popup. Safe to call anywhere on the client. */
export function openBuyCredits(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BUY_CREDITS_EVENT));
}

/** GET /api/billing/summary: what the popup needs to sell credits. */
export interface BillingSummary {
  balance: number;
  packs: Pick<CreditPack, "id" | "credits" | "price_usd">[];
  planCode: PlanCode;
  stripeConfigured: boolean;
  proPlanConfigured: boolean;
}
