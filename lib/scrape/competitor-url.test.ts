import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchHtmlMock = vi.fn();

vi.mock("./fetch-page", () => ({
  fetchHtml: (...args: unknown[]) => fetchHtmlMock(...args),
  fetchText: vi.fn(),
}));

import { scrapeCompetitorAdUrl } from "./index";

describe("scrapeCompetitorAdUrl", () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset();
  });

  it("returns guidance for a Facebook Ad Library URL without ever fetching it", async () => {
    const result = await scrapeCompetitorAdUrl(
      "https://www.facebook.com/ads/library/?id=123456",
    );
    expect(result).toEqual({
      ok: false,
      guidance: expect.stringContaining("Paste the ad copy or upload a screenshot"),
    });
    expect(fetchHtmlMock).not.toHaveBeenCalled();
  });

  it("returns guidance when the fetch fails (blocked host, timeout, non-html)", async () => {
    fetchHtmlMock.mockResolvedValueOnce(null);
    const result = await scrapeCompetitorAdUrl("https://example.com/ad");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.guidance).toContain("Paste the ad copy or upload a screenshot");
    }
  });

  it("returns guidance when the page has too little readable text", async () => {
    fetchHtmlMock.mockResolvedValueOnce({
      finalUrl: new URL("https://example.com/ad"),
      html: "<html><body>Hi</body></html>",
    });
    const result = await scrapeCompetitorAdUrl("https://example.com/ad");
    expect(result.ok).toBe(false);
  });

  it("returns the extracted text for a real page with enough content", async () => {
    const paragraph = "This amazing offer changes everything about how you work. ".repeat(6);
    fetchHtmlMock.mockResolvedValueOnce({
      finalUrl: new URL("https://example.com/ad"),
      html: `<html><body><p>${paragraph}</p></body></html>`,
    });
    const result = await scrapeCompetitorAdUrl("https://example.com/ad");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("This amazing offer changes everything");
    }
  });

  it("returns guidance for an unparseable URL instead of throwing", async () => {
    const result = await scrapeCompetitorAdUrl("not a url");
    expect(result.ok).toBe(false);
    expect(fetchHtmlMock).not.toHaveBeenCalled();
  });
});
