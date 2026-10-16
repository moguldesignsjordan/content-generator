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
  addShareImages,
  dropSiteDefaults,
  isProductPath,
  mergeProducts,
  nameFromUrl,
  shareImage,
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

describe("services and other offers", () => {
  it("treats service, menu, class, and listing pages as offers, never their index pages", () => {
    expect(isProductPath("https://a.com/services/web-design")).toBe(true);
    expect(isProductPath("https://a.com/menu/brisket-plate")).toBe(true);
    expect(isProductPath("https://a.com/treatments/hydrafacial")).toBe(true);
    expect(isProductPath("https://a.com/classes/beginner-yoga")).toBe(true);
    expect(isProductPath("https://a.com/listings/12-oak-st")).toBe(true);
    expect(isProductPath("https://a.com/services")).toBe(false);
    expect(isProductPath("https://a.com/services/")).toBe(false);
  });

  it("reads JSON-LD Service, and a service page's Open Graph tags", () => {
    const service = `<script type="application/ld+json">{"@type":"Service","name":"Drain Cleaning","description":"Same-day drain clearing.","image":"/img/drain.jpg","offers":{"price":"149","priceCurrency":"USD"}}</script>`;
    expect(parseProductPage(service, "https://plumb.example.com/services/drains")).toMatchObject({
      name: "Drain Cleaning",
      price_point: "$149",
      image_url: "https://plumb.example.com/img/drain.jpg",
    });
    const og = `<meta property="og:title" content="Web Design | Mogul Design Agency"><meta property="og:image" content="/og/web.png">`;
    expect(parseProductPage(og, "https://moguldesignagency.com/services/web-design")).toMatchObject({
      name: "Web Design",
      image_url: "https://moguldesignagency.com/og/web.png",
    });
  });

  it("reads a page's share image, falling back to the Twitter one", () => {
    expect(shareImage(`<meta name="twitter:image" content="/t.png">`, "https://a.com/x")).toBe("https://a.com/t.png");
    expect(shareImage("<title>none</title>", "https://a.com/x")).toBeUndefined();
  });
});

describe("addShareImages", () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset();
  });

  it("gives on-site offers without a photo their page's share image, and leaves the rest", async () => {
    fetchHtmlMock.mockImplementation(async (url: URL) => ({
      finalUrl: url,
      html: `<meta property="og:image" content="/og${url.pathname}.png">`,
    }));
    const out = await addShareImages(
      [
        { slug: "seo", name: "SEO", url: "https://www.agency.com/services/seo" },
        { slug: "ads", name: "Ads", url: "https://other.com/ads" },
        { slug: "web", name: "Web", url: "https://agency.com/services/web", image_url: "https://x/kept.png" },
        { slug: "brand", name: "Brand" },
      ],
      "https://agency.com",
    );
    expect(out.map((p) => p.image_url)).toEqual([
      "https://www.agency.com/og/services/seo.png",
      undefined,
      "https://x/kept.png",
      undefined,
    ]);
    expect(fetchHtmlMock).toHaveBeenCalledTimes(1);
  });
});

describe("mergeProducts", () => {
  it("keeps the extraction's words, adds the scan's photo and price, and appends what only the scan found", () => {
    const extracted = [
      { slug: "web-design", name: "Web Design", description: "Custom sites, 6 pages.", deliverables: ["Design", "Build"] },
      { slug: "branding", name: "Branding", url: "https://a.com/services/brand", price_point: "$2,500" },
    ];
    const structured = [
      { slug: "web-design", name: "Web Design", description: "Short meta text", image_url: "https://a.com/web.png" },
      { slug: "brand-identity", name: "Brand Identity", url: "https://a.com/services/brand", image_url: "https://a.com/b.png", price_point: "$9" },
      { slug: "stickers", name: "Stickers", image_url: "https://a.com/s.png" },
    ];
    expect(mergeProducts(extracted, structured)).toEqual([
      { ...extracted[0], image_url: "https://a.com/web.png" },
      { ...extracted[1], image_url: "https://a.com/b.png" },
      structured[2],
    ]);
  });
});

describe("dropSiteDefaults", () => {
  it("names pages that share the site-wide title from their address, and drops shared text and photos", () => {
    const shared = { name: "Mogul Design Agency", description: "We design brands.", image_url: "https://a.com/og.png" };
    const out = dropSiteDefaults(
      [
        { slug: "x", url: "https://a.com/services/web-design", ...shared },
        { slug: "x", url: "https://a.com/services/automations", ...shared },
        { slug: "cards", name: "Business Cards", description: "Thick cards.", image_url: "https://a.com/cards.png", url: "https://a.com/products/cards" },
      ],
      "Mogul Design Agency",
    );
    expect(out).toEqual([
      { slug: "web-design", name: "Web Design", url: "https://a.com/services/web-design" },
      { slug: "automations", name: "Automations", url: "https://a.com/services/automations" },
      { slug: "cards", name: "Business Cards", description: "Thick cards.", image_url: "https://a.com/cards.png", url: "https://a.com/products/cards" },
    ]);
  });

  it("renames a single page whose name is just the site's title", () => {
    expect(
      dropSiteDefaults([{ slug: "acme", name: "Acme Co", url: "https://acme.com/services/roof-repair" }], "acme co")[0].name,
    ).toBe("Roof Repair");
  });

  it("reads a name from an address", () => {
    expect(nameFromUrl("https://a.com/menu/brisket_plate.html")).toBe("Brisket Plate");
    expect(nameFromUrl("https://a.com/")).toBe("");
  });
});
