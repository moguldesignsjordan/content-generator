import { describe, expect, it } from "vitest";
import { emailHtmlToText, stripEmDashes } from "./text";

describe("stripEmDashes", () => {
  it("replaces the unicode em-dash and both HTML entities", () => {
    expect(stripEmDashes("a—b &mdash; c &#8212; d")).toBe("a, b ,  c ,  d");
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
});
