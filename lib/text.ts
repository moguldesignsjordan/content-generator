// Em-dashes are banned from all copy this engine produces (brand voice rule).
// Replace the unicode char and HTML entities with ", " so the sentence still
// reads naturally. Double-hyphen (--) is intentionally NOT replaced here because
// CSS custom properties (var(--color)) and HTML comments (<!-- -->) use it
// legitimately inside email HTML; prose ` -- ` is rare enough to skip.
export function stripEmDashes(text: string): string {
  return text
    .replace(/—/g, ", ") // — (unicode em-dash)
    .replace(/&mdash;/gi, ", ") // HTML named entity
    .replace(/&#8212;/g, ", "); // HTML numeric entity
}

/**
 * Joins the text blocks of one agent turn into the single message the user
 * reads. A turn can span several tool round-trips, each contributing its own
 * text block, so concatenating them raw produced two bugs the chat actually
 * shipped: no separator ("Got it!Who is this email for?") and the same question
 * emitted twice across steps, printed twice.
 *
 * Blank segments are dropped, repeats are dropped (the model re-stating its
 * question after a tool result is not new information), and what's left is
 * separated by a blank line.
 */
export function joinReplySegments(segments: string[]): string {
  const kept: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || kept.includes(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept.join("\n\n");
}

/**
 * Strips markdown emphasis and heading syntax from text that will be shown as
 * PLAIN text: the chat bubbles and the email/flyer copy fields, which are
 * rendered literally, so a stray ** reaches the reader as two asterisks. The
 * prompts already forbid markdown; this is the belt to that suspenders.
 *
 * Only the syntax that actually leaks is removed (bold/italic markers, ATX
 * headings, bullet asterisks). Deliberately NOT run on email HTML, where ** and
 * # are legitimate inside styles and anchors.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/gs, "$1")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/(^|\s)\*(?=\S)(.+?)\*(?=\s|$)/gs, "$1$2")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*\*[ \t]+/gm, "- ")
    .replace(/\*\*/g, "");
}

interface MimePart {
  headers: Record<string, string>;
  body: string;
}

/** Splits a raw MIME chunk into its header map and body. Folded header
 * continuation lines (leading whitespace) are unfolded first. */
function splitMimeHeaders(raw: string): MimePart {
  const normalized = raw.replace(/\r\n/g, "\n");
  const blank = normalized.indexOf("\n\n");
  const headBlock = blank === -1 ? normalized : normalized.slice(0, blank);
  const body = blank === -1 ? "" : normalized.slice(blank + 2);
  const headers: Record<string, string> = {};
  for (const line of headBlock.replace(/\n[ \t]+/g, " ").split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (match) headers[match[1].toLowerCase()] = match[2].trim();
  }
  return { headers, body };
}

/** True when the paste opens with an RFC-822 header block, i.e. someone pasted a
 * .eml file or Gmail's "show original" export rather than the email itself. */
function looksLikeRawEmail(input: string): boolean {
  const head = input.replace(/\r\n/g, "\n").split("\n\n", 1)[0];
  const lines = head.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 3) return false;
  const headerLines = lines.filter((l) => /^[A-Za-z][A-Za-z0-9-]*:\s/.test(l) || /^[ \t]/.test(l));
  if (headerLines.length / lines.length < 0.8) return false;
  return /^(content-type|delivered-to|received|mime-version|return-path|message-id):/im.test(head);
}

function paramOf(headerValue: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"?([^";\\s]+)"?`, "i").exec(headerValue)?.[1];
}

/** Splits a multipart body on its boundary delimiter, dropping the preamble and
 * everything after the closing `--boundary--` marker. */
function splitOnBoundary(body: string, boundary: string): string[] {
  const delim = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed === delim) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    if (trimmed === `${delim}--`) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join("\n"));
  return parts;
}

/** Decodes quoted-printable to bytes first, so multi-byte UTF-8 sequences
 * (an emoji arrives as =F0=9F=93=B0) rejoin into one character instead of four
 * mojibake ones. */
function decodeQuotedPrintable(input: string, encoding: BufferEncoding): string {
  const noSoftBreaks = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const hex = noSoftBreaks.slice(i + 1, i + 3);
    if (noSoftBreaks[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      for (const byte of Buffer.from(noSoftBreaks[i], "utf8")) bytes.push(byte);
    }
  }
  return Buffer.from(bytes).toString(encoding);
}

function decodeMimeBody(part: MimePart): string {
  const contentType = part.headers["content-type"] ?? "";
  const charset = paramOf(contentType, "charset")?.toLowerCase() ?? "";
  const encoding: BufferEncoding = /^(iso-8859|windows-125)/.test(charset) ? "latin1" : "utf8";
  const transfer = (part.headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (transfer === "base64") {
    try {
      return Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString(encoding);
    } catch {
      return part.body;
    }
  }
  if (transfer === "quoted-printable") return decodeQuotedPrintable(part.body, encoding);
  return part.body;
}

/** Walks a MIME tree and collects the first readable html and plain text parts.
 * Attachments and non-text parts (images, calendar invites) are skipped. */
function collectTextParts(part: MimePart): { html?: string; plain?: string } {
  const contentType = (part.headers["content-type"] ?? "text/plain").toLowerCase();
  if (contentType.startsWith("multipart/")) {
    const boundary = paramOf(part.headers["content-type"] ?? "", "boundary");
    if (!boundary) return {};
    const found: { html?: string; plain?: string } = {};
    for (const chunk of splitOnBoundary(part.body, boundary)) {
      const sub = collectTextParts(splitMimeHeaders(chunk));
      if (sub.html && !found.html) found.html = sub.html;
      if (sub.plain && !found.plain) found.plain = sub.plain;
    }
    return found;
  }
  if (/attachment/i.test(part.headers["content-disposition"] ?? "")) return {};
  if (!contentType.startsWith("text/")) return {};
  const decoded = decodeMimeBody(part);
  return contentType.startsWith("text/html") ? { html: decoded } : { plain: decoded };
}

/**
 * Unwraps a raw .eml / "show original" paste down to the readable email body,
 * preferring the html part (it carries the layout the reference library learns
 * from) and falling back to text/plain. Anything that is not a raw email is
 * returned untouched.
 */
export function unwrapRawEmail(input: string): string {
  if (!looksLikeRawEmail(input)) return input;
  const root = splitMimeHeaders(input);
  const { html, plain } = collectTextParts(root);
  return html ?? plain ?? input;
}

/**
 * Flattens pasted email HTML to readable plain text while keeping paragraph
 * breaks (they carry the style: paragraph size is part of what the reference
 * email library is trying to learn). Plain-text input passes through nearly
 * untouched. Raw .eml / Gmail "show original" exports are unwrapped first, so a
 * non-technical user can paste whatever their mail client gave them. Used when
 * saving reference emails and chat-pasted style examples.
 */
export function emailHtmlToText(input: string): string {
  let text = unwrapRawEmail(input);
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|table|h[1-6]|li|blockquote)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
