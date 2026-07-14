import { describe, expect, it } from "vitest";
import { sanitizeEditedFragment } from "./sanitize-fragment";

describe("sanitizeEditedFragment safety", () => {
  it("drops a script tag and its contents", () => {
    expect(sanitizeEditedFragment("<p>Hi</p><script>alert(1)</script>")).toBe("<p>Hi</p>");
  });

  it("strips event handlers", () => {
    expect(sanitizeEditedFragment('<p onclick="steal()">Hi</p>')).toBe("<p>Hi</p>");
  });

  it("unwraps a javascript: link but keeps its text", () => {
    expect(sanitizeEditedFragment('<p><a href="javascript:alert(1)">Click</a></p>')).toBe(
      "<p>Click</p>",
    );
  });

  it("keeps a normal link", () => {
    expect(sanitizeEditedFragment('<p><a href="https://example.com">Docs</a></p>')).toBe(
      '<p><a href="https://example.com">Docs</a></p>',
    );
  });

  it("keeps the MailerLite unsubscribe merge tag, which the email must not lose", () => {
    expect(sanitizeEditedFragment('<p><a href="{$unsubscribe}">Unsubscribe</a></p>')).toBe(
      '<p><a href="{$unsubscribe}">Unsubscribe</a></p>',
    );
  });

  it("removes an iframe outright", () => {
    expect(sanitizeEditedFragment('<p>a</p><iframe src="https://evil.com"></iframe>')).toBe(
      "<p>a</p>",
    );
  });
});

describe("sanitizeEditedFragment tidying of contentEditable output", () => {
  it("turns the <div> the browser inserts on Enter into a <p>", () => {
    expect(sanitizeEditedFragment("<p>One</p><div>Two</div>")).toBe("<p>One</p><p>Two</p>");
  });

  it("unwraps the empty span execCommand leaves behind", () => {
    // Exactly what Cmd+B produced in the browser spike.
    expect(sanitizeEditedFragment("<p>Some <span>text</span></p>")).toBe("<p>Some text</p>");
  });

  it("unwraps a legacy <font> tag but keeps the text", () => {
    expect(sanitizeEditedFragment('<p><font color="red">Red</font></p>')).toBe("<p>Red</p>");
  });

  it("drops pasted classes and ids", () => {
    expect(sanitizeEditedFragment('<p class="from-word" id="x">Pasted</p>')).toBe("<p>Pasted</p>");
  });

  it("keeps bold and italic runs", () => {
    expect(sanitizeEditedFragment("<p>A <strong>bold</strong> and <em>italic</em> run</p>")).toBe(
      "<p>A <strong>bold</strong> and <em>italic</em> run</p>",
    );
  });

  it("converts &nbsp; to a normal space", () => {
    expect(sanitizeEditedFragment("<p>a&nbsp;b</p>")).toBe("<p>a b</p>");
  });
});

describe("sanitizeEditedFragment style handling", () => {
  it("keeps allowlisted inline styles for email", () => {
    expect(
      sanitizeEditedFragment('<p style="color:#111;font-size:16px">Hi</p>', { allowStyle: true }),
    ).toBe('<p style="color:#111;font-size:16px">Hi</p>');
  });

  it("drops styles entirely for blog, where the stylesheet owns the look", () => {
    expect(sanitizeEditedFragment('<p style="color:#111">Hi</p>')).toBe("<p>Hi</p>");
  });

  it("drops a CSS property that isn't on the allowlist", () => {
    expect(
      sanitizeEditedFragment('<p style="position:fixed;color:#111">Hi</p>', { allowStyle: true }),
    ).toBe('<p style="color:#111">Hi</p>');
  });

  it("drops a url() payload smuggled into a style value", () => {
    expect(
      sanitizeEditedFragment('<p style="background:url(https://evil.com/x)">Hi</p>', {
        allowStyle: true,
      }),
    ).toBe("<p>Hi</p>");
  });
});
