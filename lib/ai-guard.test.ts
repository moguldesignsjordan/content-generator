import { beforeEach, describe, expect, it, vi } from "vitest";

// The credit lookup is the only DB touch in the guard; stub it so these stay
// pure unit tests. The RPC/ledger behavior is verified against the real
// database, not mocked here.
const hasSufficientCredits = vi.fn();
vi.mock("@/lib/billing/credits", () => ({
  hasSufficientCredits: (...args: unknown[]) => hasSufficientCredits(...args),
}));
vi.mock("@/lib/db/queries", () => ({
  getBrandByDraftId: vi.fn(),
  getLogStats: vi.fn().mockResolvedValue({ estimatedUsd24h: 0 }),
}));
vi.mock("@/lib/log", () => ({ logWarn: vi.fn() }));

const { checkCredits, checkRateLimit, guardAiRoute } = await import("./ai-guard");

const BRAND_A = "aaaaaaaa-0000-0000-0000-000000000000";
const BRAND_B = "bbbbbbbb-0000-0000-0000-000000000000";

beforeEach(() => {
  hasSufficientCredits.mockReset();
  hasSufficientCredits.mockResolvedValue(true);
  delete process.env.DAILY_SPEND_LIMIT_USD;
});

describe("checkCredits", () => {
  it("blocks with an outOfCredits signal, not a generic rate-limit message", () => {
    hasSufficientCredits.mockResolvedValue(false);
    return checkCredits(BRAND_A).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.status).toBe(429);
      // The UI keys off this to show "buy credits" instead of "try again in
      // 30s". Telling a broke customer to wait is a dead end: waiting never
      // fixes it.
      expect(r.outOfCredits).toBe(true);
      expect(r.upgradeUrl).toBe("/billing");
    });
  });

  it("passes when the brand has a balance", async () => {
    hasSufficientCredits.mockResolvedValue(true);
    expect((await checkCredits(BRAND_A)).ok).toBe(true);
  });
});

describe("guardAiRoute rate limiting", () => {
  it("keys the window per brand, so one customer can't rate-limit another", async () => {
    // Brand A burns its whole allowance.
    for (let i = 0; i < 3; i++) {
      const r = await guardAiRoute("generate", { brandId: BRAND_A, limit: 3 });
      expect(r.ok).toBe(true);
    }
    const blocked = await guardAiRoute("generate", { brandId: BRAND_A, limit: 3 });
    expect(blocked.ok).toBe(false);
    expect(blocked.outOfCredits).toBeFalsy(); // rate-limited, NOT out of credits

    // Brand B, same operation, must be completely unaffected.
    const other = await guardAiRoute("generate", { brandId: BRAND_B, limit: 3 });
    expect(other.ok).toBe(true);
  });

  it("checks credits before letting a call through", async () => {
    hasSufficientCredits.mockResolvedValue(false);
    const r = await guardAiRoute("redesign", { brandId: BRAND_B, limit: 5 });
    expect(r.ok).toBe(false);
    expect(r.outOfCredits).toBe(true);
    expect(hasSufficientCredits).toHaveBeenCalledWith(BRAND_B, 1);
  });

  it("skips the credit check when there's no brand to charge", async () => {
    await guardAiRoute("some-unattributed-op", { limit: 5 });
    expect(hasSufficientCredits).not.toHaveBeenCalled();
  });

  it("rate-limits BEFORE spending a DB round trip on the credit check", async () => {
    const op = `cheap-first-${Date.now()}`;
    await guardAiRoute(op, { brandId: BRAND_A, limit: 1 });
    hasSufficientCredits.mockClear();
    const blocked = await guardAiRoute(op, { brandId: BRAND_A, limit: 1 });
    expect(blocked.ok).toBe(false);
    expect(hasSufficientCredits).not.toHaveBeenCalled();
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit inside the window, then blocks with a retry hint", () => {
    const key = `k-${Date.now()}`;
    expect(checkRateLimit(key, 2, 60_000).ok).toBe(true);
    expect(checkRateLimit(key, 2, 60_000).ok).toBe(true);
    const third = checkRateLimit(key, 2, 60_000);
    expect(third.ok).toBe(false);
    expect(third.status).toBe(429);
    expect(third.error).toMatch(/try again/i);
  });
});
