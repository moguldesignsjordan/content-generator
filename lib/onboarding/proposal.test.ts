import { describe, expect, it } from "vitest";
import type { Brand, Icp, OnboardingProposal, Strategy } from "@/lib/db/types";
import type { WebsiteImport } from "@/lib/pipeline/import-website";
import {
  buildProposal,
  mainActionLine,
  provisionalName,
  snapshotToWrites,
  voiceToWrites,
  withProtocol,
  type BusinessResearch,
} from "./proposal";

const site: WebsiteImport = {
  proposal: {
    voice_profile: {
      voice: "Plain and friendly",
      tone: "Calm",
      example_posts: ["We fix roofs right the first time."],
    },
    positioning: {
      business_description: "Roof repair for Dallas homeowners.",
      tagline: "Dry homes, fast.",
      differentiators: ["Same-day inspections"],
      competitors: ["Big Roof Co"],
    },
    products: [{ slug: "roof-repair", name: "Roof repair" }],
    visual_identity: {
      logo_url: "https://cdn.example.com/logo.png",
      colors: { primary: "#112233", accent: "#ff3366" },
      footer: { website: "https://acmeroofing.com", contact_email: "hi@acmeroofing.com" },
    },
    source_url: "https://acmeroofing.com",
  },
  extras: {
    brand_name: "Acme Roofing",
    phone: "(214) 555-0101",
    service_area: "Dallas",
    main_action: { kind: "call", wording: "a free roof inspection" },
    audience: { label: "Dallas homeowners", pains: ["Leaks after storms"] },
  },
};

const research: BusinessResearch = {
  name: "Acme Roofing LLC",
  phone: "(214) 555-0199",
  rating: "4.8 stars from 120 Google reviews",
  praise: ["Same-day inspections", "Cleaned up after the job"],
  pains: ["leaks after storms", "Insurance claims"],
  customer_words: ["roof leak"],
  objections: ["Cost"],
  competitors: ["big roof co", "Lone Star Roofing"],
  postal_address: "1 Main St, Dallas, TX",
  sources: [{ url: "https://yelp.com/biz/acme", title: "Acme on Yelp" }],
};

describe("buildProposal", () => {
  it("uses the site alone when there's no research", () => {
    const p = buildProposal({ site, research: null, input: { url: "acmeroofing.com" } });
    expect(p.name).toBe("Acme Roofing");
    expect(p.phone).toBe("(214) 555-0101");
    expect(p.website).toBe("https://acmeroofing.com");
    expect(p.products).toHaveLength(1);
    expect(p.example_lines).toEqual(["We fix roofs right the first time."]);
    expect(p.main_action).toEqual({ kind: "call", wording: "a free roof inspection" });
    expect(p.guesses).toEqual(["audience"]);
    expect(p.sources).toEqual([]);
  });

  it("builds from research and the owner's words when there's no site", () => {
    const p = buildProposal({
      site: null,
      research,
      input: { name: "Acme", description: "We fix roofs.", city: "Dallas" },
    });
    expect(p.name).toBe("Acme Roofing LLC");
    expect(p.description).toBe("We fix roofs.");
    expect(p.service_area).toBe("Dallas");
    expect(p.products).toEqual([]);
    expect(p.rating).toBe("4.8 stars from 120 Google reviews");
    expect(p.audience.vocabulary).toEqual(["roof leak"]);
    expect(p.sources).toHaveLength(1);
  });

  it("lets the site win where both found something, and merges chips without duplicates", () => {
    const p = buildProposal({ site, research, input: { url: "acmeroofing.com" } });
    expect(p.name).toBe("Acme Roofing");
    expect(p.phone).toBe("(214) 555-0101");
    expect(p.postal_address).toBe("1 Main St, Dallas, TX");
    expect(p.differentiators).toEqual(["Same-day inspections", "Cleaned up after the job"]);
    expect(p.competitors).toEqual(["Big Roof Co", "Lone Star Roofing"]);
    expect(p.audience.pains).toEqual(["Leaks after storms", "Insurance claims"]);
  });

  it("tags nothing as a guess when no audience was found", () => {
    const p = buildProposal({ site: null, research: null, input: { name: "Acme" } });
    expect(p.guesses).toEqual([]);
    expect(p.name).toBe("Acme");
  });
});

describe("withProtocol", () => {
  it("turns a typed domain into a link and leaves real links alone", () => {
    expect(withProtocol(" acme.com ")).toBe("https://acme.com");
    expect(withProtocol("http://acme.com")).toBe("http://acme.com");
    expect(withProtocol("")).toBeUndefined();
  });

  it("is applied when the site couldn't be read", () => {
    expect(buildProposal({ site: null, research: null, input: { url: "acme.com" } }).website).toBe(
      "https://acme.com",
    );
  });
});

describe("provisionalName", () => {
  it("prefers the typed name, then the bare domain", () => {
    expect(provisionalName({ name: " Acme " })).toBe("Acme");
    expect(provisionalName({ url: "https://www.acmeroofing.com/about" })).toBe("acmeroofing.com");
  });
});

describe("mainActionLine", () => {
  it("writes a call with the real phone and what they get", () => {
    expect(mainActionLine({ kind: "call", wording: "a free roof inspection" }, "(214) 555-0101")).toBe(
      "Call (214) 555-0101 for a free roof inspection",
    );
  });

  it("points bookings and orders at the site", () => {
    expect(mainActionLine({ kind: "book", wording: "a cleaning" }, undefined, "https://www.smile.com/")).toBe(
      "Book a cleaning at smile.com",
    );
    expect(mainActionLine({ kind: "order", url: "https://shop.example.com/order" })).toBe(
      "Order online at shop.example.com/order",
    );
  });

  it("is undefined without a kind", () => {
    expect(mainActionLine({}, "(214) 555-0101")).toBeUndefined();
  });
});

describe("snapshotToWrites", () => {
  const brand = {
    id: "b1",
    name: "acmeroofing.com",
    voice_profile: { banned_terms: ["cheap"], cta_library: { newsletter_signup: "Join us." } },
    visual_identity: { footer: { postal_address: "Old address" }, image_gen: { auto: false } },
    positioning: {},
    mailerlite_config: { sender_email: "owner@acme.com" },
    seo_defaults: {},
  } as unknown as Brand;
  const strategy = {
    id: "s1",
    funnel_definition: { awareness: { cta_type: "newsletter_signup" }, decision: { cta_type: "book_call" } },
  } as unknown as Strategy;
  const primaryIcp = { id: "i1", label: "Primary ICP", profile: {} } as unknown as Icp;
  const snapshot: OnboardingProposal = {
    ...buildProposal({ site, research, input: { url: "acmeroofing.com" } }),
    differentiators: ["Same-day inspections"],
  };
  const writes = snapshotToWrites(snapshot, { brand, strategy, primaryIcp });

  it("renames the brand and keeps its sender settings", () => {
    expect(writes.basics.name).toBe("Acme Roofing");
    expect(writes.basics.mailerlite_config).toEqual({ sender_email: "owner@acme.com" });
  });

  it("writes only the ticked differentiators, plus area and the main action line", () => {
    expect(writes.positioning.differentiators).toEqual(["Same-day inspections"]);
    expect(writes.positioning.service_area).toBe("Dallas");
    expect(writes.positioning.main_action).toBe("Call (214) 555-0101 for a free roof inspection");
  });

  it("merges the footer and keeps settings onboarding doesn't own", () => {
    expect(writes.visualIdentity.footer?.phone).toBe("(214) 555-0101");
    expect(writes.visualIdentity.footer?.postal_address).toBe("1 Main St, Dallas, TX");
    expect(writes.visualIdentity.logo_alt).toBe("Acme Roofing");
    expect(writes.visualIdentity.image_gen).toEqual({ auto: false });
  });

  it("writes a real ICP label and profile", () => {
    expect(writes.icp?.label).toBe("Dallas homeowners");
    expect(writes.icp?.profile.pains).toEqual(["Leaks after storms", "Insurance claims"]);
  });

  it("makes the main action the decision and consideration CTA, never touching banned terms", () => {
    expect(writes.voiceProfile?.cta_library).toEqual({
      newsletter_signup: "Join us.",
      book_call: "Call (214) 555-0101 for a free roof inspection",
    });
    expect(writes.voiceProfile?.banned_terms).toEqual(["cheap"]);
    expect(writes.funnel).toEqual({
      awareness: { cta_type: "newsletter_signup" },
      consideration: { cta_type: "book_call" },
      decision: { cta_type: "book_call" },
    });
  });

  it("leaves products out when none are ticked, and skips CTA writes with no action", () => {
    const bare = snapshotToWrites(
      { ...snapshot, products: [], main_action: {}, audience: {} },
      { brand, strategy, primaryIcp },
    );
    expect(bare.products).toEqual([]);
    expect(bare.voiceProfile).toBeNull();
    expect(bare.funnel).toBeNull();
    expect(bare.icp).toBeNull();
  });
});

describe("voiceToWrites", () => {
  const pick = { voice: "Warm", tone: "Upbeat", text: "A sample about roof repair." };

  it("keeps the site's lines as examples when there are enough", () => {
    const v = voiceToWrites(pick, ["Line one.", "Line two."], { banned_terms: ["cheap"] });
    expect(v.example_posts).toEqual(["Line one.", "Line two."]);
    expect(v.banned_terms).toEqual(["cheap"]);
    expect(v.voice).toBe("Warm");
  });

  it("adds the picked sample when the site gave fewer than two lines", () => {
    expect(voiceToWrites(pick, ["Line one."], {}).example_posts).toEqual([
      "Line one.",
      "A sample about roof repair.",
    ]);
  });
});
