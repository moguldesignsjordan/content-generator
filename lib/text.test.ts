import { describe, expect, it } from "vitest";
import { emailHtmlToText, stripEmDashes, stripMarkdown } from "./text";

describe("stripEmDashes", () => {
  it("replaces the unicode em-dash and both HTML entities", () => {
    expect(stripEmDashes("a—b &mdash; c &#8212; d")).toBe("a, b ,  c ,  d");
  });
});

describe("stripMarkdown", () => {
  it("unwraps bold and italic emphasis", () => {
    expect(stripMarkdown("This is **really** good and *nice* too")).toBe(
      "This is really good and nice too",
    );
  });

  it("drops heading markers and asterisk bullets", () => {
    expect(stripMarkdown("## Your update\n\n* one\n* two")).toBe(
      "Your update\n\n- one\n- two",
    );
  });

  it("removes stray unpaired asterisk pairs", () => {
    expect(stripMarkdown("Save 40% **today")).toBe("Save 40% today");
  });

  it("leaves ordinary prose and math alone", () => {
    const plain = "Book a call. 3 x 4 = 12, and 50% off ends Friday.";
    expect(stripMarkdown(plain)).toBe(plain);
  });
});

describe("emailHtmlToText", () => {
  it("passes plain text through nearly untouched", () => {
    const input = "Hey there,\n\nTwo short lines.\n\nJordan";
    expect(emailHtmlToText(input)).toBe(input);
  });

  it("flattens HTML while keeping paragraph breaks", () => {
    const html =
      "<html><head><style>p{color:red}</style></head><body>" +
      "<p>First paragraph.</p><p>Second one.</p>" +
      "<ul><li>Point A</li><li>Point B</li></ul>" +
      "</body></html>";
    const text = emailHtmlToText(html);
    expect(text).toContain("First paragraph.\n\nSecond one.");
    expect(text).toContain("- Point A");
    expect(text).not.toContain("<");
    expect(text).not.toContain("color:red");
  });

  it("converts <br> to newlines and decodes common entities", () => {
    expect(emailHtmlToText("Hi&nbsp;there<br>Line two &amp; more")).toBe(
      "Hi there\nLine two & more",
    );
  });

  it("collapses runs of blank lines left by table markup", () => {
    const text = emailHtmlToText("<div>a</div><div></div><div></div><div>b</div>");
    expect(text).toBe("a\n\nb");
  });

  it("unwraps a raw multipart export and decodes quoted-printable", () => {
    const raw = [
      "Delivered-To: jordan@example.com",
      "Received: by 10.0.0.1 with SMTP id x;",
      "        Sun, 13 Jul 2026 09:00:00 -0700 (PDT)",
      "From: Lids <deals@lids.com>",
      "Subject: 40% off today",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="000000000000abc"',
      "",
      "--000000000000abc",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Plain fallback copy.",
      "",
      "--000000000000abc",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<div><p>Save 40% =F0=9F=93=B0 today only</p><p>Shop hats =",
      "and caps now</p></div>",
      "",
      "--000000000000abc--",
      "",
    ].join("\r\n");

    const text = emailHtmlToText(raw);
    expect(text).toContain("Save 40% 📰 today only");
    expect(text).toContain("Shop hats and caps now");
    expect(text).not.toContain("=3D");
    expect(text).not.toContain("Content-Type");
    expect(text).not.toContain("Delivered-To");
    expect(text).not.toContain("--000000000000abc");
    expect(text).not.toContain("Plain fallback copy.");
  });

  it("falls back to the text/plain part when there is no html part", () => {
    const raw = [
      "Delivered-To: jordan@example.com",
      "Received: by 10.0.0.1 with SMTP id x;",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hello Jordan,",
      "",
      "Here=E2=80=99s your update.",
    ].join("\r\n");

    expect(emailHtmlToText(raw)).toBe("Hello Jordan,\n\nHere’s your update.");
  });

  it("decodes a base64 html part", () => {
    const body = Buffer.from("<p>Hi there</p>", "utf8").toString("base64");
    const raw = [
      "Delivered-To: jordan@example.com",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n");

    expect(emailHtmlToText(raw)).toBe("Hi there");
  });

  it("leaves ordinary prose that happens to contain a colon alone", () => {
    const input = "Goal: sell hats\n\nWe want more orders this week.";
    expect(emailHtmlToText(input)).toBe(input);
  });
});
