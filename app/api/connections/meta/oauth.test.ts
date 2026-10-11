import { describe, expect, it } from "vitest";
import { newState, redirectUri, statesMatch } from "./oauth";

describe("Meta OAuth state", () => {
  it("accepts the state it issued", () => {
    const s = newState();
    expect(statesMatch(s, s)).toBe(true);
  });

  it("rejects a missing or different state", () => {
    const s = newState();
    expect(statesMatch(s, null)).toBe(false);
    expect(statesMatch(undefined, s)).toBe(false);
    expect(statesMatch(s, newState())).toBe(false);
    expect(statesMatch(s, `${s}x`)).toBe(false);
  });

  it("builds the callback URI from the request origin", () => {
    expect(redirectUri("http://localhost:3000")).toBe(
      "http://localhost:3000/api/connections/meta/callback",
    );
  });
});
