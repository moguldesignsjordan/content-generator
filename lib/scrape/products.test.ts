import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchHtmlMock = vi.fn();
const fetchTextMock = vi.fn();

vi.mock("./fetch-page", () => ({
  fetchHtml: (...args: unknown[]) => fetchHtmlMock(...args),
  fetchText: (...args: unknown[]) => fetchTextMock(...args),
  fetchBinary: vi.fn(),
}));
vi.mock("./url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./url")>()),
  assertPublicHost: vi.fn(async () => {}),
}));
vi.mock("@/lib/images/optimize", () => ({ optimizeEmailImage: vi.fn() }));
vi.mock("@/lib/pipeline/generate-image", () => ({ uploadContentImage: vi.fn() }));

import {
  isProductPath,
  linksFromHome,
  parseProductPage,
  parseShopifyProducts,
  parseSitemap,
  scrapeProducts,
  sitemapsFromRobots,
} from "./products";

const site = new URL("https://moguldesignagency.com");

const JSON_LD_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"Ignore me"},
  {"@type":"Product","name":"Business Cards","description":"<p>Thick 16pt matte cards.</p>",
   "image":["/img/cards.jpg"],"offers":{"@type":"Offer","price":"60.00","priceCurrency":"USD"}}
]}</script>
<meta property="og:title" content="Wrong title | Mogul Print">
</head><body></body></html>`;

const OG_PAGE = `<html><head>
<meta property="og:title" content="Door Hangers | Mogul Print">
<meta property="og:description" content="Die-cut hangers that get read.">
<meta property="og:image" content="https://cdn.sanity.io/images/hangers.png">
<meta property="product:price:amount" content="45">
<meta property="product:price:currency" content="EUR">
</head><body></body></html>`;

describe("sitemaps", () => {
  it("reads Sitemap lines from robots.txt", () => {
    expect(
      sitemapsFromRobots("User-agent: *\nDisallow: /cart\nSitemap: https://print.example.com/sitemap.xml\nsitemap: /other.xml", site),
    ).toEqual(["https://print.example.com/sitemap.xml", "https://moguldesignagency.com/other.xml"]);
  });

  it("reads pages from a urlset and children from an index", () => {
    expect(
      parseSitemap(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.com/products/cards</loc></url><url><loc> https://a.com/about </loc></url></urlset>`,
      ),
    ).toEqual({ pages: ["https://a.com/products/cards", "https://a.com/about"], children: [] });
    expect(
      parseSitemap(
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://a.com/sitemap-products.xml</loc></sitemap></sitemapindex>`,
      ),
    ).toEqual({ pages: [], children: ["https://a.com/sitemap-products.xml"] });
  });
});

describe("isProductPath", () => {
  it("accepts one product's page and rejects listings and other pages", () => {
    expect(isProductPath("https://a.com/products/business-cards")).toBe(true);
    expect(isProductPath("https://a.com/shop/door-hangers")).toBe(true);
    expect(isProductPath("https://a.com/products")).toBe(false);
    expect(isProductPath("https://a.com/about")).toBe(false);
    expect(isProductPath("https://a.com/blog/new-cards")).toBe(false);
  });
});

describe("linksFromHome", () => {
  it("finds product links and the site's own shop subdomains, never other sites", () => {
    const html = `<a href="https://print.moguldesignagency.com">Shop</a>
      <a href="/products/banners">Banners</a>
      <a href="https://blog.moguldesignagency.com">Blog</a>
      <a href="https://print.other.com">Other</a>`;
    expect(linksFromHome(html, site)).toEqual({
      products: ["https://moguldesignagency.com/products/banners"],
      subdomains: ["https://print.moguldesignagency.com"],
    });
  });
});

describe("parseProductPage", () => {
  it("prefers JSON-LD Product, inside @graph, with absolute image and price", () => {
    expect(parseProductPage(JSON_LD_PAGE, "https://print.example.com/products/cards")).toEqual({
      slug: "business-cards",
      name: "Business Cards",
      description: "Thick 16pt matte cards.",
      price_point: "$60.00",
      url: "https://print.example.com/products/cards",
      image_url: "https://print.example.com/img/cards.jpg",
    });
  });

  it("falls back to Open Graph, dropping the site name from the title", () => {
    expect(parseProductPage(OG_PAGE, "https://print.example.com/products/hangers")).toEqual({
      slug: "door-hangers",
      name: "Door Hangers",
      description: "Die-cut hangers that get read.",
      price_point: "45 EUR",
      url: "https://print.example.com/products/hangers",
      image_url: "https://cdn.sanity.io/images/hangers.png",
    });
  });

  it("reads an AggregateOffer's low price as a from-price", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Banners","offers":{"@type":"AggregateOffer","lowPrice":89,"priceCurrency":"USD"}}</script>`;
    expect(parseProductPage(html, "https://a.com/products/banners")?.price_point).toBe("From $89");
  });

  it("is null for a page with no product data", () => {
    expect(parseProductPage("<title>About us</title>", "https://a.com/products/x")).toBeNull();
    expect(parseProductPage('<script type="application/ld+json">{oops</script>', "https://a.com/p/x")).toBeNull();
  });
});

describe("parseShopifyProducts", () => {
  it("maps title, body, first variant price, first image, and handle", () => {
    const json = JSON.stringify({
      products: [
        {
          title: "Yard Signs",
          handle: "yard-signs",
          body_html: "<p>Corrugated, weatherproof.</p>",
          images: [{ src: "https://cdn.shopify.com/yard.jpg" }],
          variants: [{ price: "25.00" }],
        },
        { title: "" },
      ],
    });
    expect(parseShopifyProducts(json, site)).toEqual([
      {
        slug: "yard-signs",
        name: "Yard Signs",
        description: "Corrugated, weatherproof.",
        price_point: "$25.00",
        url: "https://moguldesignagency.com/products/yard-signs",
        image_url: "https://cdn.shopify.com/yard.jpg",
      },
    ]);
    expect(parseShopifyProducts("not json", site)).toEqual([]);
  });
});

describe("scrapeProducts", () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset();
    fetchTextMock.mockReset();
  });

  it("follows the homepage to the shop subdomain's sitemap and reads each product page", async () => {
    const pages: Record<string, string> = {
      "https://moguldesignagency.com/": `<a href="https://print.moguldesignagency.com/">Shop</a>`,
      "https://print.moguldesignagency.com/products/cards": JSON_LD_PAGE,
      "https://print.moguldesignagency.com/products/hangers": OG_PAGE,
    };
    fetchHtmlMock.mockImplementation(async (url: URL) =>
      pages[url.toString()] ? { finalUrl: url, html: pages[url.toString()] } : null,
    );
    const texts: Record<string, string> = {
      "https://print.moguldesignagency.com/robots.txt": "Sitemap: https://print.moguldesignagency.com/sitemap.xml",
      "https://print.moguldesignagency.com/sitemap.xml": `<urlset><url><loc>https://print.moguldesignagency.com/products/cards</loc></url><url><loc>https://print.moguldesignagency.com/products/hangers</loc></url><url><loc>https://print.moguldesignagency.com/about</loc></url></urlset>`,
    };
    fetchTextMock.mockImplementation(async (url: URL) => texts[url.toString()] ?? null);

    const out = await scrapeProducts("moguldesignagency.com");
    expect(out.origin).toBe("https://moguldesignagency.com");
    expect(out.products.map((p) => p.name).sort()).toEqual(["Business Cards", "Door Hangers"]);
    // The about page was never fetched: it isn't a product page.
    expect(fetchHtmlMock.mock.calls.map(([u]) => String(u))).not.toContain(
      "https://print.moguldesignagency.com/about",
    );
  });

  it("uses Shopify's products.json when it's there", async () => {
    fetchHtmlMock.mockResolvedValue({ finalUrl: new URL("https://shop.example.com/"), html: "<p>Hi</p>" });
    fetchTextMock.mockImplementation(async (url: URL) =>
      url.pathname === "/products.json"
        ? JSON.stringify({ products: [{ title: "Mugs", handle: "mugs" }] })
        : null,
    );
    const out = await scrapeProducts("https://shop.example.com");
    expect(out.products.map((p) => p.name)).toEqual(["Mugs"]);
  });

  it("returns no products for a site without product data", async () => {
    fetchHtmlMock.mockResolvedValue({ finalUrl: new URL("https://agency.example.com/"), html: "<a href='/about'>About</a>" });
    fetchTextMock.mockResolvedValue(null);
    expect((await scrapeProducts("agency.example.com")).products).toEqual([]);
  });
});
