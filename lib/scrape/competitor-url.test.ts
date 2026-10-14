import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchHtmlMock = vi.fn();

vi.mock("./fetch-page", () => ({
  fetchHtml: (...args: unknown[]) => fetchHtmlMock(...args),
  fetchText: vi.fn(),
}));

import { scrapeCompetitorAdUrl } from "./index";
import { parseAdLibraryUrl } from "./url";

describe("scrapeCompetitorAdUrl", () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset();
  });

  it("points a Facebook Ad Library URL at the import, without ever fetching it", async () => {
    const result = await scrapeCompetitorAdUrl(
      "https://www.facebook.com/ads/library/?id=123456",
    );
    expect(result).toEqual({
      ok: false,
      guidance: expect.stringContaining("Media > Competitor Ads > Ad Library"),
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

describe("parseAdLibraryUrl", () => {
  it("reads the page id, country, and status from an advertiser link", () => {
    expect(
      parseAdLibraryUrl(
        "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US" +
          "&is_targeted_country=false&media_type=all&search_type=page" +
          "&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id=21281155105",
      ),
    ).toEqual({ pageId: "21281155105", country: "US", status: "ACTIVE" });
  });

  it("defaults country and status when the link leaves them out", () => {
    expect(parseAdLibraryUrl("facebook.com/ads/library/?view_all_page_id=42")).toEqual({
      pageId: "42",
      country: "US",
      status: "ACTIVE",
    });
  });

  it("keeps ALL and inactive filters", () => {
    expect(
      parseAdLibraryUrl(
        "https://www.facebook.com/ads/library/?view_all_page_id=42&country=ALL&active_status=all",
      ),
    ).toEqual({ pageId: "42", country: "ALL", status: "ALL" });
  });

  it("returns null for a keyword search, a single ad, or another site", () => {
    expect(parseAdLibraryUrl("https://www.facebook.com/ads/library/?q=shoes")).toBeNull();
    expect(parseAdLibraryUrl("https://www.facebook.com/ads/library/?id=123")).toBeNull();
    expect(parseAdLibraryUrl("https://example.com/ads/library/?view_all_page_id=42")).toBeNull();
    expect(parseAdLibraryUrl("not a url")).toBeNull();
  });
});
