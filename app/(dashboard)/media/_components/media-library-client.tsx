"use client";

import { useRef, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  SegmentedControl,
  Sheet,
  useToast,
} from "@/components/ui";
import { PlusIcon } from "@/components/ui/icons";
import type {
  CompetitorReference,
  MediaAsset,
  MediaAssetKind,
  StyleReference,
} from "@/lib/db/types";
import { StyleReferencePanel } from "./style-reference-panel";
import { CompetitorReferencePanel } from "./competitor-reference-panel";

const KIND_LABELS: Record<MediaAssetKind, string> = {
  hero: "Hero",
  flyer: "Flyer",
  product: "Product",
  general: "Upload",
};

function MediaAssetCard({
  asset,
  onDelete,
}: {
  asset: MediaAsset;
  onDelete: () => void;
}) {
  const toast = useToast();

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(asset.url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="aspect-[4/3] w-full bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.alt ?? ""}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{KIND_LABELS[asset.kind]}</Badge>
          <Badge tone={asset.source === "generated" ? "violet" : "cyan"}>
            {asset.source === "generated" ? "Generated" : "Uploaded"}
          </Badge>
        </div>
        <p className="text-[11px] text-muted">
          {new Date(asset.created_at).toLocaleDateString()}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={copyUrl}>
            Copy URL
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function MyMediaTab({ initialMedia }: { initialMedia: MediaAsset[] }) {
  const toast = useToast();
  const [items, setItems] = useState(initialMedia);
  const [addOpen, setAddOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handlePick(picked: File) {
    if (!picked.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }

  async function handleUpload() {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "general");
      const res = await fetch("/api/uploads/image", { method: "POST", body });
      const data = (await res.json()) as {
        url?: string;
        width?: number;
        height?: number;
        error?: string;
      };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
      // The upload route doesn't echo the created row, so fetch the library
      // fresh to pick up the id it just recorded.
      const listRes = await fetch("/api/media");
      const listData = (await listRes.json()) as { assets?: MediaAsset[] };
      if (listData.assets) setItems(listData.assets);
      setAddOpen(false);
      setFile(null);
      setPreview(null);
      toast.success("Saved to your media library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/media/${confirmDeleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((a) => a.id !== confirmDeleteId));
      toast.success("Deleted.");
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-medium text-muted transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <PlusIcon size={16} /> Upload an image to your library
      </button>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          Nothing here yet. Generate a hero image on a draft, or upload one
          directly, and it'll show up here to reuse later.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((asset) => (
            <MediaAssetCard
              key={asset.id}
              asset={asset}
              onDelete={() => setConfirmDeleteId(asset.id)}
            />
          ))}
        </div>
      )}

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Upload an image"
        description="Add an image straight to your library, no draft required."
        footer={
          <div className="flex gap-2">
            <Button variant="subtle" className="flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={uploading}
              disabled={!file}
              onClick={handleUpload}
            >
              Save to library
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {preview ? (
            <div className="overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Preview" className="max-h-56 w-full object-contain" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted transition hover:border-foreground/30 hover:text-foreground"
            >
              Tap to pick an image (JPEG, PNG, or WebP, up to 10MB)
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handlePick(picked);
              e.target.value = "";
            }}
          />
          {preview && (
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              Pick another
            </Button>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this image?"
        description="Drafts that already used it keep rendering; you just can't reuse it again."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

export function MediaLibraryClient({
  initialMedia,
  initialFlyerStyles,
  initialEmailDesigns,
  initialCompetitorRefs,
}: {
  initialMedia: MediaAsset[];
  initialFlyerStyles: StyleReference[];
  initialEmailDesigns: StyleReference[];
  initialCompetitorRefs: CompetitorReference[];
}) {
  const [tab, setTab] = useState<"media" | "flyer" | "email" | "competitor">("media");

  return (
    <div>
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "media", label: "My Media" },
          { value: "flyer", label: "Flyer Styles" },
          { value: "email", label: "Email Designs" },
          { value: "competitor", label: "Competitor Ads" },
        ]}
      />
      <div className="mt-5">
        {tab === "media" && <MyMediaTab initialMedia={initialMedia} />}
        {tab === "flyer" && (
          <StyleReferencePanel kind="flyer" initialItems={initialFlyerStyles} />
        )}
        {tab === "email" && (
          <StyleReferencePanel kind="email" initialItems={initialEmailDesigns} />
        )}
        {tab === "competitor" && (
          <CompetitorReferencePanel initialItems={initialCompetitorRefs} />
        )}
      </div>
    </div>
  );
}
