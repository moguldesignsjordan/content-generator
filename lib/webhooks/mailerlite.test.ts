import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashBody,
  parseEvents,
  parseSigningSecrets,
  verifySignature,
} from "./mailerlite";

// The signature check is the entire auth for the webhook route, so it gets the
// adversarial cases (wrong secret, tampered body, missing/garbage header), not
// just the happy path.

const SECRET = "4jQ3Y4UlLI";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifySignature", () => {
  const body = JSON.stringify({ event: "campaign.sent", id: "123" });

  it("accepts a payload signed with the connection's secret", () => {
    expect(verifySignature(body, sign(body), [SECRET])).toBe(true);
  });

  it("accepts when ANY registered secret signs it", () => {
    // One secret per subscription: campaign.sent can't be batchable, and
    // campaign.open/click must be, so they're registered separately.
    expect(verifySignature(body, sign(body, "second"), [SECRET, "second"])).toBe(
      true,
    );
  });

  it("rejects a signature from a different secret", () => {
    expect(verifySignature(body, sign(body, "attacker"), [SECRET])).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ event: "campaign.sent", id: "999" });
    expect(verifySignature(tampered, signature, [SECRET])).toBe(false);
  });

  it("rejects a missing, empty, or wrong-length signature", () => {
    expect(verifySignature(body, null, [SECRET])).toBe(false);
    expect(verifySignature(body, "", [SECRET])).toBe(false);
    expect(verifySignature(body, "abc", [SECRET])).toBe(false);
  });

  it("rejects when the connection has no secrets at all", () => {
    expect(verifySignature(body, sign(body), [])).toBe(false);
    expect(verifySignature(body, sign(body), [""])).toBe(false);
  });

  it("tolerates surrounding whitespace in the header", () => {
    expect(verifySignature(body, `  ${sign(body)}  `, [SECRET])).toBe(true);
  });
});

describe("parseSigningSecrets", () => {
  it("splits the stored blob and drops blanks", () => {
    expect(parseSigningSecrets("a, b ,,c")).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when unset", () => {
    expect(parseSigningSecrets(undefined)).toEqual([]);
    expect(parseSigningSecrets("")).toEqual([]);
  });
});

describe("hashBody", () => {
  it("is stable for identical bytes and differs otherwise", () => {
    expect(hashBody("{}")).toBe(hashBody("{}"));
    expect(hashBody("{}")).not.toBe(hashBody("{ }"));
  });
});

describe("parseEvents", () => {
  it("reads campaign.sent, whose top-level id IS the campaign", () => {
    expect(
      parseEvents({
        id: "77",
        name: "July newsletter",
        total_recipients: 120,
        event: "campaign.sent",
        account_id: "1",
      }),
    ).toEqual([{ type: "campaign.sent", campaignId: "77" }]);
  });

  it("reads a nested campaign id from campaign.click", () => {
    expect(
      parseEvents({
        type: "campaign.click",
        subscriber: { id: "9", email: "a@b.co" },
        campaign: { id: "77" },
        link_url: "https://example.com",
        account_id: "1",
      }),
    ).toEqual([{ type: "campaign.click", campaignId: "77" }]);
  });

  it("unwraps a batched delivery", () => {
    const events = parseEvents({
      total: 2,
      events: [
        { type: "campaign.open", campaign: { id: "77" }, subscriber: { id: "1" } },
        { type: "campaign.open", campaign: { id: "77" }, subscriber: { id: "2" } },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.campaignId === "77")).toBe(true);
  });

  it("coerces a numeric campaign id to a string", () => {
    // publications.external_id is text; a number here would never match.
    expect(parseEvents({ event: "campaign.sent", id: 77 })[0].campaignId).toBe("77");
  });

  it("keeps non-campaign events but gives them no campaign id", () => {
    expect(parseEvents({ event: "subscriber.created", id: "5" })).toEqual([
      { type: "subscriber.created", campaignId: undefined },
    ]);
  });

  it("yields nothing for junk rather than throwing", () => {
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents("nope")).toEqual([]);
    expect(parseEvents({ no_event_field: true })).toEqual([]);
    expect(parseEvents({ events: [null, 3, {}] })).toEqual([]);
  });
});
