import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getSessionUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/pipeline/extract-look", () => ({ extractLookProfile: vi.fn() }));
const deleteDesignLook = vi.fn();
vi.mock("@/lib/db/queries", () => ({
  getSingleBrand: async () => ({ id: "brand-mine" }),
  // Only the caller's own look is found; any other id belongs to someone else.
  getDesignLook: async (id: string, brandId: string) =>
    id === "look-mine" && brandId === "brand-mine" ? { id, brand_id: brandId } : null,
  deleteDesignLook: (...a: unknown[]) => deleteDesignLook(...a),
  updateDesignLook: vi.fn(),
}));

import { DELETE } from "./route";

const req = new Request("http://x") as unknown as import("next/server").NextRequest;

describe("DELETE /api/looks/[id]", () => {
  it("deletes the caller's own look", async () => {
    const res = await DELETE(req, { params: Promise.resolve({ id: "look-mine" }) });
    expect(res.status).toBe(200);
    expect(deleteDesignLook).toHaveBeenCalledWith("look-mine", "brand-mine");
  });

  it("refuses another brand's look with a 404 and deletes nothing", async () => {
    deleteDesignLook.mockClear();
    const res = await DELETE(req, { params: Promise.resolve({ id: "look-theirs" }) });
    expect(res.status).toBe(404);
    expect(deleteDesignLook).not.toHaveBeenCalled();
  });
});
