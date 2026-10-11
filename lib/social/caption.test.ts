import { describe, expect, it } from "vitest";
import { buildSocialCaption } from "./caption";

const copy = { headline: "H", caption: "  New drop is live.  " };

describe("buildSocialCaption", () => {
  it("puts hashtags on their own line after the caption", () => {
    expect(buildSocialCaption({ ...copy, hashtags: ["branding", "#design"] })).toBe(
      "New drop is live.\n\n#branding #design",
    );
  });

  it("normalizes stray # marks and spaces", () => {
    expect(buildSocialCaption({ ...copy, hashtags: ["##small business", " ", "#"] })).toBe(
      "New drop is live.\n\n#smallbusiness",
    );
  });

  it("returns just the caption when there are no hashtags", () => {
    expect(buildSocialCaption(copy)).toBe("New drop is live.");
  });
});
