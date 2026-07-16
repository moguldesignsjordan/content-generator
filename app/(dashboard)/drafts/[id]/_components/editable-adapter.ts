import type { BlogCopy, ContentImage } from "@/lib/db/types";
import type { StyleChanges } from "@/lib/email/inline-style";
import { ApiError } from "@/lib/billing/toast-error";

// The seam between the ONE inline editor (inline-preview.tsx) and the two
// things it can edit. Email and blog get the same component, the same
// interactions, and the same features; only what happens on save differs —
// an email splices sanitized HTML into its stored document, a blog converts
// the edit back to markdown and patches its structured copy.
//
// Everything type-specific lives in an adapter. inline-preview.tsx knows
// nothing about emails, blogs, regions or fields.

/** One editable element in the preview, identified the same way for both types. */
export interface EditTarget {
  /** data-region (email) or data-field (blog) value, e.g. "headline" / "intro". */
  marker: string;
  /**
   * Which one, when the marker repeats. For email this is the 0-based
   * occurrence of the region in the document; for blog it is the section's
   * data-index. Both are just "the Nth", which is why one field serves both.
   */
  index: number;
  /** Human label shown in the toolbar and the rewrite modal, e.g. "Headline". */
  label: string;
  /** The element's current inner HTML, as rendered. */
  innerHtml: string;
  /** The element's current visible text, used to seed a rewrite. */
  text: string;
}

export interface SaveResult {
  html: string;
  /** Blog only: the re-rendered structured copy. */
  copy?: BlogCopy;
}

export interface EditableAdapter {
  /** The attribute the preview renderer tags editable elements with. */
  markerAttr: "data-region" | "data-field";
  /** Plain-language name for a marker, e.g. "headline" -> "Headline". */
  labelFor(marker: string): string;
  /** Whether this element may be edited inline at all (an image can't). */
  isEditable(marker: string): boolean;
  /**
   * Whether this element is edited through a form instead of typing on it.
   * A button is the case in point: contentEditable on the CTA let a
   * select-all-delete remove the <a> itself, vaporizing the button. These
   * markers open the Design panel (with a text field) on the second click.
   */
  usesFormEditor?(marker: string): boolean;
  /**
   * Which specialized Design-panel layout a marker gets: "button" adds the
   * wording field (the CTA), "header" strips the panel down to logo alignment
   * only. Undefined means the full style controls.
   */
  designVariant?(marker: string): "button" | "header" | undefined;
  /** Whether the AI Rewrite action makes sense for this element (default yes — a logo has no words to rewrite). */
  canRewrite?(marker: string): boolean;
  /** Whether light markdown (bold/links/bullets) is meaningful in this element. */
  allowsMarkdown(marker: string): boolean;
  /** Whether this element may be deleted, given the whole document's current state. */
  canDelete(target: EditTarget, doc: Document): boolean;
  /** Why deletion is blocked, when canDelete is false but the element is deletable in principle. */
  deleteBlockedReason?(target: EditTarget, doc: Document): string | null;

  /** Persist an inline edit: the HTML the user typed, sanitized. */
  save(target: EditTarget, innerHtml: string): Promise<SaveResult>;
  /**
   * Persist proposed TEXT (the rewrite modal's "Use this").
   *
   * Separate from save() on purpose. The model returns text, and the two types
   * need it placed differently: an email wraps it in the section's existing
   * paragraph markup, while a blog field stores it as-is, because for a blog
   * body that text IS markdown and wrapping it in <p> would escape the syntax
   * into literal asterisks.
   */
  applyText(target: EditTarget, text: string): Promise<SaveResult>;
  /** Remove the element entirely. */
  remove(target: EditTarget): Promise<SaveResult>;
  /** Propose new wording. Never commits — the modal decides. */
  rewrite(target: EditTarget, instruction?: string): Promise<string>;

  /**
   * Mechanical style controls. Email only: a blog article's look comes from the
   * renderer's stylesheet, so there is nothing per-element to restyle, and the
   * toolbar hides the Design button when this is absent.
   */
  applyStyle?(target: EditTarget, changes: StyleChanges): Promise<SaveResult>;

  /**
   * Relabels a button with plain text, server-side and deterministic (no AI,
   * no contentEditable round-trip). Present for the markers usesFormEditor
   * returns true for — the Design panel's "Button text" field calls this.
   */
  applyButtonText?(target: EditTarget, text: string): Promise<SaveResult>;

  /** Email only: the hero image controls hang off the same preview. */
  image?: {
    initial?: ContentImage;
  };
}

/** Shared fetch helper: every adapter route answers { ...payload } or { error }. */
export async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
  fallbackError: string,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    outOfCredits?: boolean;
    upgradeUrl?: string;
  };
  if (!res.ok) throw new ApiError(data.error ?? fallbackError, data);
  return data;
}

export const postJson = <T>(url: string, body: unknown, fallbackError: string): Promise<T> =>
  sendJson<T>("POST", url, body, fallbackError);

export const patchJson = <T>(url: string, body: unknown, fallbackError: string): Promise<T> =>
  sendJson<T>("PATCH", url, body, fallbackError);
