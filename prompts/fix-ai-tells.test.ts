import { describe, expect, it } from "vitest";
import { buildFixAiTellsMessages } from "./fix-ai-tells";
import type { EmailCopy } from "@/lib/db/types";

const COPY: EmailCopy = {
  subject: "s",
  preheader: "p",
  headline: "h",
  body_sections: [{ heading: "Why", body: "Built to convert, not just exist." }],
  cta_text: "Go",
};

describe("buildFixAiTellsMessages", () => {
  const { system, user } = buildFixAiTellsMessages(COPY, ["Built to convert, not just exist"]);

  it("lists the flagged phrases and the full copy", () => {
    expect(user).toContain("- Built to convert, not just exist");
    expect(user).toContain("SECTION 1 BODY: Built to convert, not just exist.");
  });

  it("carries the tell patterns but not the auditor's instructions", () => {
    expect(system).toContain("'It's not just X, it's Y'");
    expect(system).not.toContain("ai_tells_found");
    expect(system).not.toContain("Flag only real");
  });
});
