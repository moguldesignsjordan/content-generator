import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const getBrandWithIcps = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: () => getSessionUser() }));
vi.mock("@/lib/db/queries", () => ({ getBrandWithIcps: (id: string) => getBrandWithIcps(id) }));

import { requireOwnBrand, requireOwnStrategy } from "./brand-access";

beforeEach(() => {
  getSessionUser.mockResolvedValue({ id: "user-1" });
  getBrandWithIcps.mockResolvedValue({ brand: { id: "brand-mine" }, strategy: { id: "strat-mine" }, icps: [] });
});

describe("requireOwnBrand", () => {
  it("lets the signed-in user write to their own brand", async () => {
    const r = await requireOwnBrand("brand-mine");
    expect(r.ok).toBe(true);
  });

  it("refuses another brand's id with the same 404 as a missing one", async () => {
    const other = await requireOwnBrand("brand-someone-else");
    const missing = await requireOwnBrand(undefined);
    expect(other.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!other.ok && !missing.ok) {
      expect(other.response.status).toBe(404);
      expect(missing.response.status).toBe(404);
    }
  });

  it("refuses a signed-out request", async () => {
    getSessionUser.mockResolvedValue(null);
    const r = await requireOwnBrand("brand-mine");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});

describe("requireOwnStrategy", () => {
  it("accepts only the user's own strategy", async () => {
    expect((await requireOwnStrategy("strat-mine")).ok).toBe(true);
    const other = await requireOwnStrategy("strat-other");
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.response.status).toBe(404);
  });
});
