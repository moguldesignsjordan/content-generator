import { describe, expect, it } from "vitest";
import { computeNextRunAt, nextSocialPostDates, SOCIAL_POST_WEEKDAYS } from "./cadence";

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

describe("nextSocialPostDates", () => {
  // 2026-10-11 is a Sunday.
  it("skips the next two days for review, then lists Mon/Wed/Fri", () => {
    expect(nextSocialPostDates(new Date("2026-10-11T13:00:00Z"))).toEqual([
      "2026-10-14",
      "2026-10-16",
      "2026-10-19",
    ]);
  });

  it("counts the review gap from the run time, so Monday's run starts Wednesday", () => {
    expect(nextSocialPostDates(new Date("2026-10-12T13:00:00Z"))).toEqual([
      "2026-10-14",
      "2026-10-16",
      "2026-10-19",
    ]);
  });

  it("only returns posting weekdays", () => {
    const days = nextSocialPostDates(new Date("2026-10-15T13:00:00Z"), 6).map((d) =>
      new Date(`${d}T00:00:00Z`).getUTCDay(),
    );
    expect(days.every((d) => SOCIAL_POST_WEEKDAYS.includes(d))).toBe(true);
  });
});
