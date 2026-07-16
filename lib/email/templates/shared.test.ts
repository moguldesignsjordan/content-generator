import { describe, expect, it } from "vitest";
import { countRegion, ensureEditableRegions } from "@/lib/email/inline-style";
import { renderFooter, renderSocialBadges, renderShell } from "./shared";
import { newsletterFeature } from "./newsletter-feature";
import type { BrandTokens } from "./types";
import type { EmailCopy } from "@/lib/db/types";

const TOKENS: BrandTokens = {
  logo_url: null,
  logo_alt: "Test Brand",
  colors: {
    primary: "#0F172A",
    secondary: "#475569",
    accent: "#2563EB",
    background: "#FFFFFF",
    text: "#0F172A",
    muted: "#64748B",
  },
  fonts: {
    heading: "Georgia, serif",
    body: "Inter, system-ui, sans-serif",
  },
  footer: {
    website: "https://www.example.com/",
    contact_email: "hi@example.com",
    postal_address: "1 Main St, Springfield",
    social: {
      linkedin: "https://linkedin.com/company/test",
      instagram: "https://instagram.com/test",
    },
  },
  sender_name: "Test Brand",
};

describe("renderFooter", () => {
  const footer = renderFooter(TOKENS);

  it("always carries the literal {$unsubscribe} merge tag", () => {
    expect(footer).toContain(`href="{$unsubscribe}"`);
  });

  it("is tagged as the footer region", () => {
    expect(footer).toContain(`data-region="footer"`);
  });

  it("renders the sender wordmark linked to the website, with the accent period", () => {
    expect(footer).toContain(`<a href="https://www.example.com/"`);
    expect(footer).toContain("Test Brand");
    expect(footer).toContain(`class="em-accent"`);
  });

  it("shows the bare domain and a mailto contact link", () => {
    expect(footer).toContain(">example.com</a>");
    expect(footer).toContain(`href="mailto:hi@example.com"`);
  });

  it("includes the postal address and a permission line", () => {
    expect(footer).toContain("1 Main St, Springfield");
    expect(footer).toContain("because you subscribed");
  });

  it("renders one circular badge per configured social link, none for the rest", () => {
    expect(footer).toContain(`href="https://linkedin.com/company/test"`);
    expect(footer).toContain(`href="https://instagram.com/test"`);
    expect(footer).toContain(`class="em-social"`);
    expect((footer.match(/em-social/g) ?? []).length).toBe(2);
  });

  it("omits the social row entirely when no links are configured", () => {
    const bare = renderFooter({ ...TOKENS, footer: { ...TOKENS.footer, social: {} } });
    expect(bare).not.toContain("em-social");
    // The legal guarantees never depend on optional fields.
    expect(bare).toContain(`href="{$unsubscribe}"`);
  });

  it("uses the real uploaded logo, not the typographic wordmark, when logo_url is set", () => {
    const branded = renderFooter({ ...TOKENS, logo_url: "https://cdn.example.com/logo.png" });
    expect(branded).toContain(`<img src="https://cdn.example.com/logo.png"`);
    expect(branded).toContain(`alt="Test Brand"`);
    // No stand-in mark once a real logo exists.
    expect(branded).not.toContain(`class="em-heading"`);
  });
});

describe("ensureEditableRegions over a real template render", () => {
  const copy: EmailCopy = {
    subject: "Subject",
    preheader: "Preview line",
    headline: "The big idea",
    body_sections: [
      { body: "A lead intro paragraph.\n\nAnd a follow-up." },
      { heading: "First point", body: "Copy for the first point." },
      { heading: "Second point", body: "Copy for the second point." },
    ],
    cta_text: "Read more",
    cta_url: "https://example.com/post",
  };
  const rendered = newsletterFeature.render({ copy, tokens: TOKENS });
  const repaired = ensureEditableRegions(rendered);

  it("tags the template's untagged lead paragraph and section headings", () => {
    // The feature template renders its editorial lead and <h2> headings
    // OUTSIDE any data-region; without repair those words are dead to the
    // inline editor (the reported "can't edit some words" bug).
    expect(rendered).toContain('<p class="em-lead"');
    expect(repaired).toContain('<p data-region="body" class="em-lead"');
    expect(repaired).toContain('<h2 data-region="body"');
    expect(countRegion(repaired, "body")).toBeGreaterThan(countRegion(rendered, "body"));
  });

  it("leaves the shell chrome alone: head, preheader, accent bar, footer, unsubscribe", () => {
    expect(repaired).toContain("prefers-color-scheme:dark"); // head style untouched
    const preheader = /<div style="display:none[^"]*"[^>]*>/.exec(repaired)?.[0];
    expect(preheader).toBeDefined();
    expect(preheader).not.toContain("data-region");
    expect(countRegion(repaired, "footer")).toBe(1);
    expect(repaired).toContain(`href="{$unsubscribe}"`);
  });

  it("is idempotent on the repaired document", () => {
    expect(ensureEditableRegions(repaired)).toBe(repaired);
  });

  it("bare renderShell survives repair without structural tagging", () => {
    const shell = renderShell(TOKENS, `<div data-region="body"><p>Hi.</p></div>`);
    const out = ensureEditableRegions(shell);
    // Header/footer/body regions only; no layout td gets promoted.
    expect(countRegion(out, "header")).toBe(1);
    expect(countRegion(out, "footer")).toBe(1);
  });
});

describe("renderSocialBadges", () => {
  it("uses text glyphs, never external icon images", () => {
    const row = renderSocialBadges(TOKENS);
    expect(row).not.toContain("<img");
    expect(row).toContain(">in</a>");
    expect(row).toContain(">ig</a>");
  });

  it("returns an empty string with no social links", () => {
    expect(renderSocialBadges({ ...TOKENS, footer: {} })).toBe("");
  });
});
