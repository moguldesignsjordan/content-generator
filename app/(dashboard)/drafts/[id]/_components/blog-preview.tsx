"use client";

import { useMemo, useRef } from "react";
import { InlinePreview } from "./inline-preview";
import { createBlogAdapter } from "./blog-adapter";
import type { BlogCopy } from "@/lib/db/types";

// The blog review surface — the SAME editor as the email review screen, with a
// different adapter. Double-click any part of the article to type on it,
// exactly as with an email; the only difference is where the edit goes on save
// (the structured blog_copy, converted back to markdown, rather than the
// email's stored HTML).

interface BlogPreviewProps {
  draftId: string;
  copy: BlogCopy | null;
  html: string;
  onSaved: (html: string, copy: BlogCopy) => void;
}

export function BlogPreview({ draftId, copy, html, onSaved }: BlogPreviewProps) {
  // The adapter reads the copy at call time, not at construction time: every
  // save returns a new one, and an edit must always build on the latest.
  const copyRef = useRef(copy);
  copyRef.current = copy;

  const adapter = useMemo(
    () => createBlogAdapter({ draftId, getCopy: () => copyRef.current }),
    [draftId],
  );

  return (
    <InlinePreview
      adapter={adapter}
      html={html}
      onHtmlChange={(result) => {
        if (result.copy) onSaved(result.html, result.copy);
      }}
      height={720}
      title="Blog preview"
    />
  );
}
