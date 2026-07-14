import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Verified against Stripe's real signature scheme by construction (HMAC-SHA256
// over "timestamp.payload", verified with the STRIPE_WEBHOOK_SECRET from the
// Stripe CLI) can't run in a unit test without real Stripe test keys. What CAN
// be verified without them is the routing logic AFTER signature verification:
// a payment-mode checkout.session.completed grants credits with the
// checkout-set metadata, a subscription-mode one doesn't, and malformed
// metadata never calls into the ledger. So constructEvent is mocked to hand
// back a fixed event, and grantCredits is mocked to inspect what it was called
// with. The live signature path is exercised with `stripe trigger` + the
// Stripe CLI once real keys exist (see PROJECT_STATE.md).

const constructEvent = vi.fn();
const grantCredits = vi.fn().mockResolvedValue(100);

vi.mock("@/lib/clients/stripe", () => ({
  isStripeConfigured: () => true,
  isStripeWebhookConfigured: () => true,
  getStripeWebhookSecret: () => "whsec_test",
  getStripe: () => ({ webhooks: { constructEvent } }),
}));
vi.mock("@/lib/billing/credits", () => ({
  grantCredits: (...args: unknown[]) => grantCredits(...args),
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
  grantCredits.mockClear();
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

  it("does NOT grant for a subscription-mode session (that's a later slice)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_sub",
          mode: "subscription",
          metadata: { brand_id: "brand-1" },
        },
      },
    });

    const res = await POST(post("{}"));
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
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

  it("is a no-op 200 for an event type this slice doesn't handle yet", async () => {
    constructEvent.mockReturnValue({
      id: "evt_4",
      type: "customer.subscription.updated",
      data: { object: {} },
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
