import { describe, expect, it } from "vitest";
import { DRAFT_MODEL, FAST_MODEL } from "../clients/model-ids";
import { priceUsage } from "../pipeline/cost";
import {
  DEFAULT_BILLING_CONFIG,
  creditsForUsage,
  currentPeriod,
  findPack,
  usageIdempotencyKey,
} from "./credits";

// The pure half of the billing meter. The RPC half (grant/debit) is enforced by
// Postgres itself (unique idempotency_key, greatest(0, ...) clamp) and is
// verified against the live DB, not mocked here: a mocked RPC would only prove
// we can mock an RPC.

const config = { creditsPerUsd: 100, markupMultiplier: 2.0 };

describe("creditsForUsage", () => {
  it("charges real cost x markup, denominated in cents", () => {
    // $0.03 real x 2.0 markup x 100 credits/$ = 6 credits.
    expect(creditsForUsage(0.03, config)).toBe(6);
  });

  it("rounds UP, so a fractional call is never under-charged", () => {
    // $0.0301 -> 6.02 credits -> 7. The business eats rounding in its favor.
    expect(creditsForUsage(0.0301, config)).toBe(7);
  });

  it("never charges zero for a call that really happened", () => {
    // A cache-heavy Haiku call can cost a tiny fraction of a cent. It still
    // costs one credit: free calls would let a loop run up real spend at no
    // charge, which is exactly the hole billing exists to close.
    expect(creditsForUsage(0.000001, config)).toBe(1);
    expect(creditsForUsage(0, config)).toBe(1);
  });

  it("is defensive about junk input rather than charging NaN", () => {
    expect(creditsForUsage(Number.NaN, config)).toBe(1);
    expect(creditsForUsage(-5, config)).toBe(1);
    expect(creditsForUsage(Number.POSITIVE_INFINITY, config)).toBe(1);
  });

  it("scales with the markup knob", () => {
    expect(creditsForUsage(0.05, { creditsPerUsd: 100, markupMultiplier: 1 })).toBe(5);
    expect(creditsForUsage(0.05, { creditsPerUsd: 100, markupMultiplier: 3 })).toBe(15);
  });

  it("does not over-charge a credit to IEEE 754 drift", () => {
    // 0.05 * 3 * 100 === 15.000000000000002 in float math, and a naive ceil
    // bills 16. An exact multiple of a credit must cost exactly that.
    expect(creditsForUsage(0.05, { creditsPerUsd: 100, markupMultiplier: 3 })).toBe(15);
    expect(creditsForUsage(0.07, { creditsPerUsd: 100, markupMultiplier: 3 })).toBe(21);
    expect(creditsForUsage(0.29, { creditsPerUsd: 100, markupMultiplier: 1 })).toBe(29);
    // But a genuine fraction still rounds up, the guarantee this must not break.
    expect(creditsForUsage(0.05001, { creditsPerUsd: 100, markupMultiplier: 3 })).toBe(16);
  });

  it("defaults to the shipped config when none is passed", () => {
    expect(creditsForUsage(0.03)).toBe(
      creditsForUsage(0.03, DEFAULT_BILLING_CONFIG),
    );
  });
});

describe("creditsForUsage against real priceUsage output", () => {
  it("prices a typical Sonnet email generation at a sane credit count", () => {
    // A real-shaped email generation: big cached brand prompt, ~4k out.
    const realUsd = priceUsage(DRAFT_MODEL, {
      input_tokens: 2_000,
      cache_read_input_tokens: 12_000,
      cache_creation_input_tokens: 0,
      output_tokens: 4_000,
    });
    const credits = creditsForUsage(realUsd, config);
    // Guard the ORDER OF MAGNITUDE, not the exact number: the point is that a
    // generation costs single-digit-to-low-double-digit credits, so the 2000
    // starter grant buys a real amount of work rather than three emails.
    expect(credits).toBeGreaterThan(0);
    expect(credits).toBeLessThan(50);
    // And that the customer is charged strictly more than the call cost us.
    expect(credits / config.creditsPerUsd).toBeGreaterThan(realUsd);
  });

  it("prices a cheap Haiku edit well below a Sonnet generation", () => {
    const haiku = creditsForUsage(
      priceUsage(FAST_MODEL, { input_tokens: 1_500, output_tokens: 400 }),
      config,
    );
    const sonnet = creditsForUsage(
      priceUsage(DRAFT_MODEL, { input_tokens: 2_000, output_tokens: 4_000 }),
      config,
    );
    expect(haiku).toBeLessThan(sonnet);
  });
});

describe("usageIdempotencyKey", () => {
  it("is stable for a given provider request id, so a replay can't double-charge", () => {
    expect(usageIdempotencyKey("msg_abc123")).toBe("usage:msg_abc123");
    expect(usageIdempotencyKey("msg_abc123")).toBe(usageIdempotencyKey("msg_abc123"));
  });

  it("falls back to a unique key when there's no request id", () => {
    // Can't dedupe a replay without an id, but must never COLLIDE, which would
    // silently drop a real debit.
    expect(usageIdempotencyKey()).not.toBe(usageIdempotencyKey());
  });
});

describe("findPack", () => {
  const packs = [
    { id: "pack_1000", credits: 1000, price_usd: 10, stripe_price_id: "price_a" },
    { id: "pack_5000", credits: 5000, price_usd: 45, stripe_price_id: "price_b" },
  ];

  it("finds a configured pack by id", () => {
    expect(findPack({ packs }, "pack_5000")).toEqual(packs[1]);
  });

  it("returns undefined for an unknown or removed pack", () => {
    // The retune-mid-flight case: a customer's browser has a checkout page
    // open for a pack that just got deleted from billing_config. The checkout
    // route must reject this cleanly, not throw.
    expect(findPack({ packs }, "pack_nonexistent")).toBeUndefined();
  });

  it("returns undefined against an empty pack list", () => {
    expect(findPack({ packs: [] }, "pack_1000")).toBeUndefined();
  });
});

describe("currentPeriod", () => {
  it("formats YYYY-MM in UTC", () => {
    expect(currentPeriod(new Date("2026-07-14T12:00:00Z"))).toBe("2026-07");
    expect(currentPeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentPeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("does not straddle months for a cron running near UTC midnight", () => {
    // Same instant, and the answer must not depend on the server's local zone.
    expect(currentPeriod(new Date("2026-08-01T00:30:00Z"))).toBe("2026-08");
    expect(currentPeriod(new Date("2026-07-31T23:30:00Z"))).toBe("2026-07");
  });
});
