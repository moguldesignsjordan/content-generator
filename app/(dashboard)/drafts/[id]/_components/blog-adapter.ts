import type { BlogCopy } from "@/lib/db/types";
import { patchJson, postJson, type EditableAdapter, type EditTarget, type SaveResult } from "./editable-adapter";

// Blog half of the shared editor. Same component, same interactions, same
// features as email — only the destination differs.
//
// The one real asymmetry: a blog article is STORED as markdown (meta.blog_copy)
// but SHOWN rendered, so an inline edit arrives as HTML and has to be converted
// back before it is saved. That conversion happens SERVER-side (in
// /blog-region), for two reasons: it keeps cheerio, a full HTML parser, out of
// the browser bundle, and it means the markdown that reaches Sanity is produced
// by the same code the round-trip tests cover (lib/blog/from-html.test.ts).
//
// Copy-level operations (deleting a section, accepting a rewrite) need no
// conversion, so they still PATCH /blog-copy with the whole object as before.

const FIELD_LABELS: Record<string, string> = {
  title: "Headline",
  slug: "URL slug",
  intro: "Intro",
  "section-heading": "Section heading",
  "section-body": "Section body",
  conclusion: "Conclusion",
  cta: "Call to action",
};

/** Fields that carry formatting. The rest are a single line of plain words. */
const MARKDOWN_FIELDS = new Set(["intro", "section-body", "conclusion"]);

export function createBlogAdapter(args: {
  draftId: string;
  /** Read the CURRENT copy at call time — it changes with every save. */
  getCopy: () => BlogCopy | null;
}): EditableAdapter {
  const { draftId, getCopy } = args;

  /** Applies one field's new stored value (markdown for body fields, plain words otherwise). */
  function withValue(target: EditTarget, value: string): BlogCopy | null {
    const copy = getCopy();
    if (!copy) return null;

    switch (target.marker) {
      case "title":
        return { ...copy, title: value };
      case "slug":
        // The preview renders the slug as "/how-to-do-x"; the stored value has no slash.
        return { ...copy, slug: value.replace(/^\/+/, "") };
      case "intro":
        return { ...copy, intro: value };
      case "conclusion":
        return { ...copy, conclusion: value };
      case "cta":
        return { ...copy, cta_text: value };
      case "section-heading":
        return {
          ...copy,
          sections: copy.sections.map((s, i) =>
            i === target.index ? { ...s, heading: value } : s,
          ),
        };
      case "section-body":
        return {
          ...copy,
          sections: copy.sections.map((s, i) =>
            i === target.index ? { ...s, body: value } : s,
          ),
        };
      default:
        return copy;
    }
  }

  const patch = (copy: BlogCopy, failure: string) =>
    patchJson<SaveResult>(`/api/drafts/${draftId}/blog-copy`, copy, failure);

  return {
    markerAttr: "data-field",

    labelFor: (marker) => FIELD_LABELS[marker] ?? marker,

    isEditable: (marker) => marker in FIELD_LABELS,

    allowsMarkdown: (marker) => MARKDOWN_FIELDS.has(marker),

    // A section (heading + body share an index) can go only while the article
    // stays above the schema's two-section minimum.
    canDelete: (target) => {
      if (target.marker !== "section-heading" && target.marker !== "section-body") return false;
      const copy = getCopy();
      return !!copy && copy.sections.length > 2;
    },

    deleteBlockedReason: (target) => {
      if (target.marker !== "section-heading" && target.marker !== "section-body") return null;
      const copy = getCopy();
      if (copy && copy.sections.length <= 2) return "An article needs two sections.";
      return null;
    },

    // The edited HTML goes to the server, which converts it back to markdown
    // and re-renders. The client never parses HTML.
    save: (target, innerHtml) =>
      postJson<SaveResult>(
        `/api/drafts/${draftId}/blog-region`,
        { field: target.marker, index: target.index, innerHtml },
        "Couldn't save your edit.",
      ),

    // An accepted rewrite is already in storage form: for a body field the
    // model returned markdown, which is exactly what blog_copy holds. Passing
    // it through the HTML path would escape the asterisks and bullets into
    // literal characters, so it is stored verbatim instead.
    applyText: async (target, text) => {
      const next = withValue(target, text.trim());
      if (!next) throw new Error("The article isn't loaded yet.");
      return patch(next, "Couldn't apply that.");
    },

    remove: async (target) => {
      const copy = getCopy();
      if (!copy) throw new Error("The article isn't loaded yet.");
      // Deleting a section drops its heading AND its body — they share an index.
      const next: BlogCopy = {
        ...copy,
        sections: copy.sections.filter((_, i) => i !== target.index),
      };
      return patch(next, "Couldn't delete that section.");
    },

    rewrite: async (target, instruction) => {
      const data = await postJson<{ text: string }>(
        `/api/drafts/${draftId}/rewrite-region`,
        {
          label: target.label,
          currentText: target.text,
          instruction,
          allowMarkdown: MARKDOWN_FIELDS.has(target.marker),
        },
        "Couldn't write a new version.",
      );
      return data.text;
    },

    // No applyStyle: a blog article's look comes from the renderer's
    // stylesheet, so there is nothing per-element to restyle. The shared
    // toolbar hides its Design button when this is absent.
  };
}
