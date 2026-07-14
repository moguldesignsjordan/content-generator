"use client";

import { useMemo, useState } from "react";
import { AccentSpinner, useToast } from "@/components/ui";
import { ImageSheet } from "./image-sheet";
import { InlinePreview } from "./inline-preview";
import { createEmailAdapter } from "./email-adapter";
import type { ContentImage } from "@/lib/db/types";
import { forceColorScheme, type EmailPreviewMode } from "@/lib/email/preview-mode";

// The email review surface. Almost all of it is now the shared InlinePreview
// (double-click to type on the email itself, toolbar for Rewrite/Design/Delete)
// — the blog review screen runs exactly the same component with a different
// adapter. What lives here is only what is genuinely email-specific: the hero
// image controls.

interface EmailPreviewProps {
  draftId: string;
  html: string;
  onHtmlChange: (html: string) => void;
  /** The hero image currently in the draft, if any (drives the move control). */
  initialImage?: ContentImage;
  /** Notified after a successful edit, so sibling UI (DesignChat's history log) can refresh. */
  onEdited?: () => void;
  /** Preview-only: forces light/dark regardless of system preference. Never affects the stored html. */
  previewMode: EmailPreviewMode;
}

export function EmailPreview({
  draftId,
  html,
  onHtmlChange,
  initialImage,
  onEdited,
  previewMode,
}: EmailPreviewProps) {
  const [imageOpen, setImageOpen] = useState(false);
  const [image, setImage] = useState<ContentImage | null>(initialImage ?? null);
  const [regenerating, setRegenerating] = useState(false);
  const toast = useToast();

  const adapter = useMemo(
    () => createEmailAdapter({ draftId, initialImage }),
    [draftId, initialImage],
  );

  const hasImage = html.includes('data-region="image"');

  /** One-tap re-roll: same style and placement, a fresh take. The ImageSheet covers everything else. */
  async function regenerateImage() {
    if (regenerating || !image || image.style === "uploaded") return;
    setRegenerating(true);
    try {
      const form = new FormData();
      form.set("mode", "generate");
      form.set("style", image.style);
      form.set("placement", image.placement ?? "top");
      const res = await fetch(`/api/drafts/${draftId}/image`, { method: "POST", body: form });
      const data = (await res.json()) as { html?: string; image?: ContentImage; error?: string };
      if (!res.ok || !data.html) throw new Error(data.error ?? "Couldn't regenerate the image.");
      onHtmlChange(data.html);
      setImage(data.image ?? null);
      onEdited?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't regenerate the image.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <InlinePreview
      adapter={adapter}
      html={html}
      onHtmlChange={(result) => onHtmlChange(result.html)}
      onEdited={onEdited}
      transformHtml={(h) => forceColorScheme(h, previewMode)}
      height={600}
      title="Email preview"
      overlay={
        <>
          {!hasImage ? (
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              className="absolute right-3 top-3 z-20 rounded-full border border-border bg-surface-2/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface-3"
            >
              Add image
            </button>
          ) : (
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
              {image && image.style !== "uploaded" && (
                <button
                  type="button"
                  onClick={regenerateImage}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface-3 disabled:opacity-60"
                >
                  {regenerating && <AccentSpinner size={12} />} Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={() => setImageOpen(true)}
                disabled={regenerating}
                className="rounded-full border border-border bg-surface-2/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface-3 disabled:opacity-60"
              >
                Edit image
              </button>
            </div>
          )}

          <ImageSheet
            open={imageOpen}
            onClose={() => setImageOpen(false)}
            draftId={draftId}
            kind="email"
            hasImage={hasImage}
            placement={image?.placement}
            promptUsed={image?.prompt}
            onApplied={(newHtml, newImage) => {
              onHtmlChange(newHtml);
              setImage(newImage);
            }}
            onEdited={onEdited}
          />
        </>
      }
    />
  );
}
