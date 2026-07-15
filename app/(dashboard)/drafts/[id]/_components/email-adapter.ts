import { DELETABLE_REGIONS, type StyleChanges } from "@/lib/email/inline-style";
import type { ContentImage } from "@/lib/db/types";
import { postJson, type EditableAdapter, type EditTarget, type SaveResult } from "./editable-adapter";

// Email half of the shared editor. Saving an email means splicing the edited
// section's HTML back into the stored document, so this adapter talks to
// /region-html (deterministic, no model) and /style-edit (mechanical CSS).
//
// The blog adapter is the same shape with a different destination — that is
// the whole difference between the two review screens.

const REGION_LABELS: Record<string, string> = {
  header: "Header",
  eyebrow: "Eyebrow",
  headline: "Headline",
  body: "Body text",
  cta: "Call to action",
  footer: "Footer",
  image: "Image",
};

export function createEmailAdapter(args: {
  draftId: string;
  initialImage?: ContentImage;
}): EditableAdapter {
  const { draftId, initialImage } = args;

  const save = (target: EditTarget, innerHtml: string) =>
    postJson<SaveResult>(
      `/api/drafts/${draftId}/region-html`,
      {
        region: target.marker,
        regionIndex: target.index,
        regionLabel: target.label,
        innerHtml,
      },
      "Couldn't save that edit.",
    );

  // Button wording travels as plain TEXT to the style-edit route, which
  // splices it inside the <a> server-side. Never through the contentEditable
  // save path: sanitizing the anchor there strips its button styling, and a
  // select-all-delete could remove the element itself.
  const applyButtonText = (target: EditTarget, text: string) =>
    postJson<SaveResult>(
      `/api/drafts/${draftId}/style-edit`,
      {
        region: target.marker,
        regionIndex: target.index,
        regionLabel: target.label,
        buttonText: text,
      },
      "Couldn't save the button text.",
    );

  return {
    markerAttr: "data-region",

    labelFor: (marker) => REGION_LABELS[marker] ?? marker,

    // The image has its own controls (generate / upload / move / remove); there
    // is no text in it to type on.
    isEditable: (marker) => marker !== "image",

    // The button edits through the Design panel's text field, never
    // contentEditable: typing on the wrapper let a select-all-delete remove
    // the <a> itself, and the button vanished with it.
    usesFormEditor: (marker) => marker === "cta",

    // Body blocks can carry links and emphasis; a headline or a button label is
    // just words.
    allowsMarkdown: (marker) => marker === "body",

    canDelete: (target, doc) => {
      const deletable = DELETABLE_REGIONS.includes(
        target.marker as (typeof DELETABLE_REGIONS)[number],
      );
      if (!deletable) return false;
      // Mirrors the server's rule, so the button is absent rather than 400-ing.
      if (target.marker === "body") {
        return doc.querySelectorAll('[data-region="body"]').length > 1;
      }
      return true;
    },

    deleteBlockedReason: (target, doc) => {
      if (
        target.marker === "body" &&
        doc.querySelectorAll('[data-region="body"]').length <= 1
      ) {
        return "An email needs one body block.";
      }
      return null;
    },

    save: (target, innerHtml) => save(target, innerHtml),

    // An accepted rewrite is plain text, so it gets rebuilt into the section's
    // existing paragraph markup — reusing the first <p>'s inline style so the
    // new copy matches the template it lives in rather than inheriting
    // browser defaults.
    applyText: (target, text) => {
      const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (!paragraphs.length) throw new Error("There's nothing to apply.");

      const escape = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // A button keeps its <a> markup no matter what: the text goes through
      // the dedicated relabel path (server splices it inside the anchor).
      // Splicing plain text over the whole section (the generic path below)
      // would delete the button element itself.
      if (target.marker === "cta") {
        return applyButtonText(target, paragraphs.join(" "));
      }

      // Does this section hold block-level content (a body), or is it a single
      // run of text (a headline, an eyebrow, a button label)?
      const isBlock = /<(p|ul|ol|h[1-4])\b/i.test(target.innerHtml);
      if (!isBlock) {
        return save(target, escape(paragraphs.join(" ")));
      }

      const pStyle = /<p\b[^>]*\sstyle="([^"]*)"/i.exec(target.innerHtml)?.[1];
      const inner = paragraphs
        .map((p) => `<p${pStyle ? ` style="${pStyle}"` : ""}>${escape(p)}</p>`)
        .join("");
      return save(target, inner);
    },

    remove: (target) =>
      postJson<SaveResult>(
        `/api/drafts/${draftId}/delete-region`,
        {
          region: target.marker,
          regionIndex: target.index,
          regionLabel: target.label,
        },
        "Couldn't delete that section.",
      ),

    rewrite: async (target: EditTarget, instruction?: string) => {
      const data = await postJson<{ text: string }>(
        `/api/drafts/${draftId}/rewrite-region`,
        {
          label: target.label,
          currentText: target.text,
          instruction,
          allowMarkdown: false,
        },
        "Couldn't write a new version.",
      );
      return data.text;
    },

    applyStyle: (target, changes: StyleChanges) =>
      postJson<SaveResult>(
        `/api/drafts/${draftId}/style-edit`,
        {
          region: target.marker,
          regionIndex: target.index,
          regionLabel: target.label,
          changes,
        },
        "Couldn't apply that change.",
      ),

    applyButtonText,

    image: { initial: initialImage },
  };
}
