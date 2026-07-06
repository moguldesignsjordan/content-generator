import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "./cadence";

describe("computeNextRunAt", () => {
  it("advances daily by 1 day", () => {
    expect(computeNextRunAt("daily", "2026-07-06T13:00:00.000Z")).toBe(
      "2026-07-07T13:00:00.000Z",
    );
  });

  it("advances weekly by 7 days", () => {
    expect(computeNextRunAt("weekly", "2026-07-06T13:00:00.000Z")).toBe(
      "2026-07-13T13:00:00.000Z",
    );
  });

  it("advances biweekly by 14 days", () => {
    expect(computeNextRunAt("biweekly", "2026-07-06T13:00:00.000Z")).toBe(
      "2026-07-20T13:00:00.000Z",
    );
  });

  it("advances monthly by 30 days", () => {
    expect(computeNextRunAt("monthly", "2026-07-06T13:00:00.000Z")).toBe(
      "2026-08-05T13:00:00.000Z",
    );
  });
});
