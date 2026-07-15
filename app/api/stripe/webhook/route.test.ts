import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Verified against Stripe's real signature scheme by construction (HMAC-SHA256
// over "timestamp.payload", verified with the STRIPE_WEBHOOK_SECRET from the
// Stripe CLI) can't run in a unit test without real Stripe test keys. What CAN
// be verified without them is the routing logic AFTER signature verification:
// a payment-mode checkout.session.completed grants credits with the
// checkout-set metadata, a subscription-mode one syncs brand_billing instead
// of granting, subscription lifecycle events sync plan/status by customer id,
// invoice.paid grants the pro allowance, and malformed metadata never calls
// into the ledger. So constructEvent is mocked to hand back a fixed event, and
// every DB/Stripe call is mocked to inspect what it was called with. The live
// signature path is exercised with `stripe trigger` + the Stripe CLI once real
// keys exist (see PROJECT_STATE.md).

const constructEvent = vi.fn();
const subscriptionsRetrieve = vi.fn();
const grantCredits = vi.fn().mockResolvedValue(100);
const upsertBrandBilling = vi.fn().mockResolvedValue({});
const getBrandBillingByCustomerId = vi.fn();
const getBillingConfig = vi.fn().mockResolvedValue({ paidMonthlyAllowance: 10000 });

vi.mock("@/lib/clients/stripe", () => ({
  isStripeConfigured: () => true,
  isStripeWebhookConfigured: () => true,
  getStripeWebhookSecret: () => "whsec_test",
  getStripe: () => ({
    webhooks: { constructEvent },
    subscriptions: { retrieve: subscriptionsRetrieve },
  }),
}));
vi.mock("@/lib/billing/credits", () => ({
  grantCredits: (...args: unknown[]) => grantCredits(...args),
  getBillingConfig: (...args: unknown[]) => getBillingConfig(...args),
}));
vi.mock("@/lib/db/queries", () => ({
  upsertBrandBilling: (...args: unknown[]) => upsertBrandBilling(...args),
  getBrandBillingByCustomerId: (...args: unknown[]) => getBrandBillingByCustomerId(...args),
}));
vi.mock("@/lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

const { POST } = await import("./route");

function post(body: string) {
  return new NextRequest("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body,
  });
}

beforeEach(() => {
  constructEvent.mockReset();
  subscriptionsRetrieve.mockReset();
  grantCredits.mockClear();
  upsertBrandBilling.mockClear();
  getBrandBillingByCustomerId.mockReset();
  getBillingConfig.mockClear();
});

describe("POST /api/stripe/webhook", () => {
  it("grants credits for a payment-mode checkout.session.completed", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          mode: "payment",
          metadata: { brand_id: "brand-1", pack_id: "pack_1000", credits: "1000" },
        },
      },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith({
      brandId: "brand-1",
      credits: 1000,
      reason: "pack_purchase",
      sourceId: "cs_test_123",
      idempotencyKey: "pack:cs_test_123",
    });
  });

  it("does NOT grant when metadata is missing (tamper/strip case), and still 200s", async () => {
    constructEvent.mockReturnValue({
      id: "evt_3",
      type: "checkout.session.completed",
      data: {
        object: { id: "cs_test_bad", mode: "payment", metadata: {} },
      },
    });

    const res = await POST(post("{}"));
    // A 500 here would make Stripe retry forever on a session that will never
    // acquire metadata by being retried; a bug we log, not a transient failure.
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("is a no-op 200 for an event type this app doesn't handle", async () => {
    constructEvent.mockReturnValue({
      id: "evt_4",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(upsertBrandBilling).not.toHaveBeenCalled();
  });

  it("upgrades the brand to pro on a subscription-mode checkout.session.completed, without granting credits", async () => {
    constructEvent.mockReturnValue({
      id: "evt_sub_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_sub",
          mode: "subscription",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { brand_id: "brand-1" },
        },
      },
    });
    subscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      items: { data: [{ current_period_end: 1750000000 }] },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(upsertBrandBilling).toHaveBeenCalledWith("brand-1", {
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      plan_code: "pro",
      status: "active",
      current_period_end: new Date(1750000000 * 1000).toISOString(),
    });
  });

  it("syncs status/period/plan on customer.subscription.updated when the subscription is live", async () => {
    getBrandBillingByCustomerId.mockResolvedValue({ brand_id: "brand-1", plan_code: "free" });
    constructEvent.mockReturnValue({
      id: "evt_sub_updated",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          items: { data: [{ current_period_end: 1750000000 }] },
        },
      },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(upsertBrandBilling).toHaveBeenCalledWith("brand-1", {
      stripe_subscription_id: "sub_1",
      status: "active",
      current_period_end: new Date(1750000000 * 1000).toISOString(),
      plan_code: "pro",
    });
  });

  it("does not demote plan_code on a non-live status update (past_due), leaving that to subscription.deleted", async () => {
    getBrandBillingByCustomerId.mockResolvedValue({ brand_id: "brand-1", plan_code: "pro" });
    constructEvent.mockReturnValue({
      id: "evt_sub_updated_2",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "past_due",
          items: { data: [{ current_period_end: 1750000000 }] },
        },
      },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(upsertBrandBilling).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({ status: "past_due", plan_code: "pro" }),
    );
  });

  it("downgrades to free on customer.subscription.deleted", async () => {
    getBrandBillingByCustomerId.mockResolvedValue({ brand_id: "brand-1", plan_code: "pro" });
    constructEvent.mockReturnValue({
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1" } },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(upsertBrandBilling).toHaveBeenCalledWith("brand-1", {
      status: "canceled",
      plan_code: "free",
    });
  });

  it("grants the paid monthly allowance on invoice.paid for a subscription invoice", async () => {
    getBrandBillingByCustomerId.mockResolvedValue({ brand_id: "brand-1", plan_code: "pro" });
    constructEvent.mockReturnValue({
      id: "evt_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          customer: "cus_1",
          parent: { subscription_details: { subscription: "sub_1" } },
        },
      },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith({
      brandId: "brand-1",
      credits: 10000,
      reason: "allowance_paid",
      sourceId: "in_1",
      idempotencyKey: "allowance:in_1",
    });
  });

  it("does NOT grant on invoice.paid for a non-subscription (one-time) invoice", async () => {
    constructEvent.mockReturnValue({
      id: "evt_invoice_paid_2",
      type: "invoice.paid",
      data: { object: { id: "in_2", customer: "cus_1", parent: null } },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("rejects a request with no stripe-signature header before touching Stripe", async () => {
    const req = new NextRequest("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("400s when signature verification throws, without granting anything", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = await POST(post("{}"));
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
