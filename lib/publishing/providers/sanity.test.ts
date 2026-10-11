import { describe, expect, it } from "vitest";
import { buildPostDocument, livePostUrl } from "./sanity";
import type { BlogCopy, Brand } from "@/lib/db/types";

const copy: BlogCopy = {
  title: "Brand strategy vs brand identity",
  slug: "brand-strategy-vs-identity",
  meta_title: "Brand Strategy vs Identity",
  meta_description: "What separates the two, and which to fix first.",
  intro: "Intro.",
  sections: [{ heading: "One", body: "Body." }],
  conclusion: "Done.",
  cta_text: "Book a call",
  faq: [{ question: "What is brand strategy?", answer: "The plan behind the look." }],
};

function brandWithSite(website?: string): Brand {
  return { visual_identity: { footer: { website } } } as Brand;
}

describe("buildPostDocument", () => {
  const doc = buildPostDocument({
    jobId: "job-1",
    postType: "post",
    copy,
    publishedAt: "2026-10-11T12:00:00.000Z",
  });

  it("creates a published doc, not a drafts.* doc", () => {
    expect(doc._id).toBe("content-engine-job-1");
  });

  it("sets the fields the site reads", () => {
    expect(doc.publishedAt).toBe("2026-10-11T12:00:00.000Z");
    expect(doc.metaTitle).toBe(copy.meta_title);
    expect(doc.metaDescription).toBe(copy.meta_description);
    expect(doc.slug).toEqual({ _type: "slug", current: copy.slug });
  });

  it("writes the FAQ as keyed array items", () => {
    expect(doc.faq).toEqual([
      {
        _key: "faq-0",
        _type: "faqItem",
        question: "What is brand strategy?",
        answer: "The plan behind the look.",
      },
    ]);
  });

  it("omits faq when the post has none", () => {
    const noFaq = buildPostDocument({
      jobId: "job-2",
      postType: "post",
      copy: { ...copy, faq: undefined },
      publishedAt: "2026-10-11T12:00:00.000Z",
    });
    expect("faq" in noFaq).toBe(false);
  });
});

describe("livePostUrl", () => {
  it("builds the post URL from the brand website", () => {
    expect(livePostUrl(brandWithSite("https://moguldesignagency.com/"), "a-post")).toBe(
      "https://moguldesignagency.com/blog/a-post",
    );
  });

  it("adds https when the website has no scheme", () => {
    expect(livePostUrl(brandWithSite("moguldesignagency.com"), "a-post")).toBe(
      "https://moguldesignagency.com/blog/a-post",
    );
  });

  it("returns null when no website is set", () => {
    expect(livePostUrl(brandWithSite(undefined), "a-post")).toBeNull();
  });
});
