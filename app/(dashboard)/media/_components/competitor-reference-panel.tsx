"use client";

import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  SegmentedControl,
  Textarea,
  useToast,
} from "@/components/ui";
import type { CompetitorReference } from "@/lib/db/types";
import type { AdLibraryAd } from "@/lib/clients/scrapecreators";
import { BulkDeleteBar, SelectToggle, useBulkSelect } from "./bulk-delete";

type InputMode = "text" | "image" | "url" | "library";
type PreviewAd = AdLibraryAd & { saved: boolean };

// Matches MAX_ADS in the save route: each saved ad is one Claude call.
const MAX_PICKED = 10;

/**
 * The competitor ad swipe file (competitor_references, migration 025): save a
 * competitor ad you want to learn the STRATEGY from, never copy. Three input
 * paths land in the same table (see app/api/competitor-references/route.ts):
 * pasted copy, an uploaded screenshot, or a URL the server scrapes. A fourth,
 * "Ad Library", previews an advertiser's Facebook Ad Library page and saves the
 * picked ads one row each (app/api/competitor-references/ad-library). Sibling
 * of StyleReferencePanel, but with several input modes instead of one image field.
 */
export function CompetitorReferencePanel({
  initialItems,
}: {
  initialItems: CompetitorReference[];
}) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [mode, setMode] = useState<InputMode>("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [libraryUrl, setLibraryUrl] = useState("");
  const [libraryAds, setLibraryAds] = useState<PreviewAd[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingAds, setLoadingAds] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bulk = useBulkSelect();
  const RowTag = bulk.selecting ? "label" : "div";

  function handlePick(picked: File) {
    if (!picked.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }

  function resetForm() {
    setName("");
    setContent("");
    setSourceUrl("");
    setFile(null);
    setPreview(null);
    setLibraryUrl("");
    setLibraryAds(null);
    setPicked(new Set());
  }

  async function handleLoadAds() {
    if (!libraryUrl.trim() || loadingAds) return;
    setLoadingAds(true);
    try {
      const res = await fetch("/api/competitor-references/ad-library/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: libraryUrl.trim() }),
      });
      const data = (await res.json()) as { ads?: PreviewAd[]; error?: string };
      if (!res.ok || !data.ads) throw new Error(data.error ?? "Couldn't load ads.");
      setLibraryAds(data.ads);
      setPicked(new Set());
      if (data.ads.length === 0) toast.error("That page has no ads to show right now.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load ads.");
    } finally {
      setLoadingAds(false);
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PICKED) next.add(id);
      else toast.error(`Save up to ${MAX_PICKED} ads at a time.`);
      return next;
    });
  }

  async function handleSaveAds() {
    if (!libraryAds || picked.size === 0 || saving) return;
    setSaving(true);
    try {
      const ads = libraryAds.filter((ad) => picked.has(ad.adArchiveId));
      const res = await fetch("/api/competitor-references/ad-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ads }),
      });
      const data = (await res.json()) as {
        references?: CompetitorReference[];
        savedIds?: string[];
        failed?: number;
        error?: string;
      };
      if (!res.ok || !data.references) throw new Error(data.error ?? "Save failed.");
      const saved = data.references;
      const savedIds = new Set(data.savedIds);
      setItems((prev) => [...saved, ...prev]);
      setLibraryAds(
        (prev) =>
          prev?.map((ad) => (savedIds.has(ad.adArchiveId) ? { ...ad, saved: true } : ad)) ??
          null,
      );
      setPicked(new Set());
      if (data.failed) {
        toast.error(`Saved ${saved.length}, ${data.failed} couldn't be saved.`);
      } else {
        toast.success(`Saved ${saved.length} ad${saved.length === 1 ? "" : "s"} to your library.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    !!name.trim() &&
    (mode === "text" ? !!content.trim() : mode === "image" ? !!file : !!sourceUrl.trim());

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("name", name.trim());
      if (mode === "image" && file) {
        body.append("file", file);
      } else if (mode === "text") {
        body.append("content", content.trim());
      } else if (mode === "url") {
        body.append("source_url", sourceUrl.trim());
      }
      if (mode !== "url" && sourceUrl.trim()) body.append("source_url", sourceUrl.trim());

      const res = await fetch("/api/competitor-references", { method: "POST", body });
      const data = (await res.json()) as { reference?: CompetitorReference; error?: string };
      if (!res.ok || !data.reference) throw new Error(data.error ?? "Save failed.");
      setItems((prev) => [data.reference!, ...prev]);
      resetForm();
      toast.success("Saved to your competitor ad library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/competitor-references/${confirmDeleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((r) => r.id !== confirmDeleteId));
      toast.success("Removed.");
    } catch {
      toast.error("Failed to remove.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <p className="text-sm text-muted">
          Save a competitor ad to learn its strategy from, hook, angle, structure, CTA.
          Never copied verbatim: generation adapts the approach in your own words.
        </p>
        <SegmentedControl
          size="sm"
          value={mode}
          onChange={(v) => {
            setMode(v);
            resetForm();
          }}
          options={[
            { value: "text", label: "Copy" },
            { value: "image", label: "Screenshot" },
            { value: "url", label: "URL" },
            { value: "library", label: "Ad Library" },
          ]}
        />
        {mode === "library" ? (
          <AdLibraryImport
            url={libraryUrl}
            onUrlChange={setLibraryUrl}
            ads={libraryAds}
            picked={picked}
            loading={loadingAds}
            saving={saving}
            onLoad={() => void handleLoadAds()}
            onToggle={togglePick}
            onSave={() => void handleSaveAds()}
          />
        ) : (
          <>
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme's Black Friday ad"
                maxLength={80}
              />
            </Field>

            {mode === "text" && (
              <Field label="Ad copy" hint="Paste the ad's text exactly as it reads.">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  placeholder="Paste the ad copy here..."
                />
              </Field>
            )}

            {mode === "image" && (
              <Field label="Screenshot" hint="A screenshot of the ad, its copy is read automatically.">
                {preview ? (
                  <div className="overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt="Preview" className="max-h-56 w-full object-contain" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted transition hover:border-foreground/30 hover:text-foreground"
                  >
                    Tap to pick an image
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => fileRef.current?.click()}
                  >
                    Pick another
                  </Button>
                )}
              </Field>
            )}

            {mode === "url" && (
              <Field
                label="Ad URL"
                hint="We'll read the page's text. For Facebook Ad Library, use the Ad Library tab instead. Other login-walled pages can't be read; paste the copy or a screenshot."
              >
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                />
              </Field>
            )}

            {mode !== "url" && (
              <Field label="Source URL (optional)">
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="Where you saw it, if you have a link"
                />
              </Field>
            )}

            <Button variant="gradient" loading={saving} disabled={!canSave} onClick={handleSave}>
              Save competitor ad
            </Button>
          </>
        )}
      </Card>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          Nothing here yet. Save a competitor ad you want to learn from, and it&apos;ll show up
          here to pick when creating a new email.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-[13px] text-muted">{items.length} saved</p>
            <SelectToggle bulk={bulk} />
          </div>
          {items.map((item) => (
            <Card key={item.id} className="space-y-3 p-4">
              {/* In select mode the whole row ticks its checkbox. */}
              <RowTag className={`flex items-start gap-3 ${bulk.selecting ? "cursor-pointer" : ""}`}>
                {bulk.selecting && (
                  <Checkbox
                    className="mt-0.5"
                    checked={bulk.selected.has(item.id)}
                    onChange={() => bulk.toggle(item.id)}
                  />
                )}
                {item.input_kind === "image" && item.image_url && (
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(item.created_at).toLocaleDateString()}
                    {item.source_url ? ` · ${item.source_url}` : ""}
                  </p>
                </div>
                {!bulk.selecting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(item.id)}
                  >
                    Remove
                  </Button>
                )}
              </RowTag>
              {item.competitor_profile ? (
                <p className="text-sm leading-relaxed text-muted">
                  {item.competitor_profile.summary}
                </p>
              ) : (
                <p className="text-sm italic text-muted">
                  Strategy analysis wasn&apos;t available; the raw ad is still saved.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <BulkDeleteBar
        bulk={bulk}
        endpoint="/api/competitor-references"
        description="Emails already generated with them keep their content; you just can't pick them again."
        onDeleted={(ids) => setItems((prev) => prev.filter((r) => !ids.includes(r.id)))}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this competitor ad?"
        description="Emails already generated with it keep their content; you just can't pick it again."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

function AdLibraryImport({
  url,
  onUrlChange,
  ads,
  picked,
  loading,
  saving,
  onLoad,
  onToggle,
  onSave,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  ads: PreviewAd[] | null;
  picked: Set<string>;
  loading: boolean;
  saving: boolean;
  onLoad: () => void;
  onToggle: (id: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Ad Library page link"
        hint="Open the advertiser's page in Facebook Ad Library and copy the link from your browser."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=..."
            className="min-w-0 flex-1"
          />
          <Button variant="outline" loading={loading} disabled={!url.trim()} onClick={onLoad}>
            Load ads
          </Button>
        </div>
      </Field>

      {ads && ads.length > 0 && (
        <>
          <p className="text-sm text-muted">
            Top ads by reach. Tick the ones worth learning from.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {ads.map((ad) => {
              const checked = picked.has(ad.adArchiveId);
              const disabled = ad.saved || ad.isTemplate;
              return (
                <label
                  key={ad.adArchiveId}
                  className={`flex flex-col overflow-hidden rounded-lg border bg-surface transition ${
                    checked ? "border-accent ring-1 ring-accent" : "border-border"
                  } ${disabled ? "opacity-60" : "cursor-pointer hover:border-foreground/30"}`}
                >
                  {ad.imageUrl && (
                    <div className="aspect-square w-full overflow-hidden bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ad.imageUrl}
                        alt={ad.headline || "Ad image"}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        size="sm"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onToggle(ad.adArchiveId)}
                      />
                      {ad.saved && <Badge tone="success">Saved</Badge>}
                      {ad.isTemplate && <Badge>Catalog ad</Badge>}
                      {ad.isVideo && <Badge tone="violet">Video</Badge>}
                    </div>
                    {ad.headline && (
                      <p className="text-sm font-medium text-foreground">{ad.headline}</p>
                    )}
                    {ad.bodyText && (
                      <p className="line-clamp-4 text-[13px] leading-relaxed text-muted">
                        {ad.bodyText}
                      </p>
                    )}
                    <p className="mt-auto text-xs text-muted">
                      {[ad.ctaText, ad.startDate ? `since ${ad.startDate}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
          <Button
            variant="gradient"
            loading={saving}
            disabled={picked.size === 0}
            onClick={onSave}
          >
            {picked.size > 0
              ? `Save ${picked.size} ad${picked.size === 1 ? "" : "s"}`
              : "Pick ads to save"}
          </Button>
        </>
      )}
    </div>
  );
}
