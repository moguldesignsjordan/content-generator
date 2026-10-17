"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, SegmentedControl, Sheet, useToast } from "@/components/ui";
import { ApiError, type ApiErrorBody, toastApiError } from "@/lib/billing/toast-error";
import { cn } from "@/lib/cn";
import type { DesignLook, LookExample } from "@/lib/db/types";
import { shrinkForUpload } from "@/lib/images/shrink-for-upload";
import type { AdLibraryAd } from "@/lib/clients/scrapecreators";

// Builds a design look: a named group of example ads/posts the owner wants
// flyers to look like. Four ways in, all landing as images re-hosted on our
// storage: upload screenshots, pick from the library (style references and
// saved competitor ads), import from a Facebook Ad Library page, or paste an
// image link. Saving reads the look once (about 10-20 seconds).

type Tab = "upload" | "library" | "ads" | "link";
const MAX_EXAMPLES = 6;

interface LibraryItem {
  id: string;
  url: string;
  label: string;
}

export function LookBuilder({
  open,
  onClose,
  onSaved,
  startAsDefault = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (look: DesignLook) => void;
  /** Opened from "add examples to our style": saving makes it the default. */
  startAsDefault?: boolean;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("upload");
  const [examples, setExamples] = useState<LookExample[]>([]);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(startAsDefault);
  useEffect(() => {
    if (open) setMakeDefault(startAsDefault);
  }, [open, startAsDefault]);
  const [busy, setBusy] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [adsUrl, setAdsUrl] = useState("");
  const [ads, setAds] = useState<AdLibraryAd[] | null>(null);
  const [pickedAds, setPickedAds] = useState<Set<string>>(new Set());
  const [link, setLink] = useState("");

  const full = examples.length >= MAX_EXAMPLES;
  const room = MAX_EXAMPLES - examples.length;

  function add(next: LookExample[]) {
    setExamples((cur) => {
      const urls = new Set(cur.map((e) => e.url));
      return [...cur, ...next.filter((e) => !urls.has(e.url))].slice(0, MAX_EXAMPLES);
    });
  }

  useEffect(() => {
    if (!open || tab !== "library" || library) return;
    void (async () => {
      try {
        const [styles, refs] = await Promise.all([
          fetch("/api/style-references?kind=flyer").then((r) => r.json()),
          fetch("/api/competitor-references").then((r) => r.json()),
        ]);
        const items: LibraryItem[] = [
          ...((styles.styles ?? []) as { id: string; image_url: string; name: string }[]).map((s) => ({
            id: s.id,
            url: s.image_url,
            label: s.name,
          })),
          ...((refs.references ?? []) as { id: string; image_url: string | null; name: string }[])
            .filter((r) => r.image_url)
            .map((r) => ({ id: r.id, url: r.image_url!, label: r.name })),
        ];
        setLibrary(items);
      } catch {
        setLibrary([]);
      }
    })();
  }, [open, tab, library]);

  async function uploadFiles(files: FileList) {
    setBusy("upload");
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const form = new FormData();
        form.append("file", await shrinkForUpload(file));
        form.append("kind", "general");
        const res = await fetch("/api/uploads/image", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't upload that image.");
        add([{ url: data.url, source: "upload" }]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload that image.");
    } finally {
      setBusy(null);
    }
  }

  async function loadAds() {
    setBusy("ads");
    try {
      const res = await fetch("/api/competitor-references/ad-library/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: adsUrl.trim() }),
      });
      const data = (await res.json()) as { ads?: AdLibraryAd[]; error?: string };
      if (!res.ok || !data.ads) throw new Error(data.error ?? "Couldn't load that page's ads.");
      setAds(data.ads.filter((a) => a.imageUrl));
      setPickedAds(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load that page's ads.");
    } finally {
      setBusy(null);
    }
  }

  async function importAds() {
    if (!ads || !pickedAds.size) return;
    setBusy("ads");
    try {
      const res = await fetch("/api/competitor-references/ad-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ads: ads.filter((a) => pickedAds.has(a.adArchiveId)) }),
      });
      const data = (await res.json()) as {
        references?: { id: string; image_url: string | null }[];
        error?: string;
      };
      if (!res.ok || !data.references) throw new Error(data.error ?? "Couldn't import those ads.");
      add(
        data.references
          .filter((r) => r.image_url)
          .map((r) => ({ url: r.image_url!, source: "ad_library" as const, ref_id: r.id })),
      );
      setPickedAds(new Set());
      toast.success("Added. They're also saved in Media > Competitor Ads.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't import those ads.");
    } finally {
      setBusy(null);
    }
  }

  async function importLink() {
    setBusy("link");
    try {
      const res = await fetch("/api/looks/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.trim() }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't import that image.");
      add([{ url: data.url, source: "url" }]);
      setLink("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't import that image.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/looks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, examples, is_default: makeDefault }),
      });
      const data = (await res.json()) as ApiErrorBody & { look?: DesignLook };
      if (!res.ok || !data.look) throw new ApiError(data.error ?? "Couldn't save the look.", data);
      toast.success(`Saved "${data.look.name}".`);
      onSaved(data.look);
      setExamples([]);
      setName("");
      setMakeDefault(false);
      onClose();
    } catch (e) {
      toastApiError(toast, e instanceof ApiError ? e : null, "Couldn't save the look.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="New look"
      description="Show 1 to 6 ads or posts you want your flyers to look like. Your brand colors are used the way they use color."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Checkbox checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            Make this my default look
          </label>
          <Button
            variant="gradient"
            loading={busy === "save"}
            disabled={!examples.length || !name.trim() || busy !== null}
            onClick={save}
          >
            Save look
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Input
          id="look-name"
          aria-label="Look name"
          placeholder="Name it, e.g. Bold print promo"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />

        {examples.length > 0 && (
          <div>
            <p className="text-[13px] font-medium text-foreground">
              Examples ({examples.length} of {MAX_EXAMPLES})
            </p>
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {examples.map((ex) => (
                <li key={ex.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ex.url} alt="" className="aspect-square w-full rounded-[var(--radius-sm)] object-cover" />
                  <button
                    type="button"
                    aria-label="Remove example"
                    onClick={() => setExamples((cur) => cur.filter((e) => e.url !== ex.url))}
                    className="absolute right-1 top-1 h-6 w-6 rounded-full bg-background/80 text-[13px] text-foreground"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "upload", label: "Upload" },
            { value: "library", label: "Library" },
            { value: "ads", label: "Ad Library" },
            { value: "link", label: "Link" },
          ]}
        />

        {tab === "upload" && (
          <div className="space-y-2">
            <input
              ref={fileRef}
              id="look-upload"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button variant="outline" loading={busy === "upload"} disabled={full} onClick={() => fileRef.current?.click()}>
              Upload screenshots
            </Button>
            <p className="text-[13px] text-muted">
              Screenshots of ads or posts you like work best, including ones from Instagram or Facebook.
            </p>
          </div>
        )}

        {tab === "library" && (
          <div>
            {library === null ? (
              <p className="text-[13px] text-muted">Loading your library…</p>
            ) : library.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nothing saved yet. Add style references or competitor ads in Media, or use another tab.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {library.map((item) => {
                  const on = examples.some((e) => e.url === item.url);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={!on && full}
                        title={item.label}
                        onClick={() =>
                          on
                            ? setExamples((cur) => cur.filter((e) => e.url !== item.url))
                            : add([{ url: item.url, source: "library", ref_id: item.id }])
                        }
                        className={cn(
                          "block w-full overflow-hidden rounded-[var(--radius-sm)] border-2 transition-colors disabled:opacity-40",
                          on ? "border-accent" : "border-transparent hover:border-border-strong",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt={item.label} className="aspect-square w-full object-cover" loading="lazy" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "ads" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="look-ads-url"
                aria-label="Facebook Ad Library link"
                placeholder="Paste a Facebook Ad Library advertiser link"
                value={adsUrl}
                onChange={(e) => setAdsUrl(e.target.value)}
              />
              <Button variant="outline" loading={busy === "ads" && !ads} disabled={!adsUrl.trim() || busy !== null} onClick={loadAds}>
                Show ads
              </Button>
            </div>
            {ads && (
              <>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {ads.map((ad) => {
                    const on = pickedAds.has(ad.adArchiveId);
                    return (
                      <li key={ad.adArchiveId}>
                        <button
                          type="button"
                          aria-pressed={on}
                          disabled={!on && pickedAds.size >= room}
                          onClick={() =>
                            setPickedAds((cur) => {
                              const next = new Set(cur);
                              if (next.has(ad.adArchiveId)) next.delete(ad.adArchiveId);
                              else next.add(ad.adArchiveId);
                              return next;
                            })
                          }
                          className={cn(
                            "block w-full overflow-hidden rounded-[var(--radius-sm)] border-2 transition-colors disabled:opacity-40",
                            on ? "border-accent" : "border-transparent hover:border-border-strong",
                          )}
                        >
                          {/* Meta CDN preview; re-hosted on import. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ad.imageUrl!} alt={ad.headline || ad.pageName} className="aspect-square w-full object-cover" loading="lazy" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Button variant="gradient" size="sm" loading={busy === "ads"} disabled={!pickedAds.size || busy !== null} onClick={importAds}>
                  Add {pickedAds.size || ""} to this look
                </Button>
              </>
            )}
          </div>
        )}

        {tab === "link" && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="look-link"
                aria-label="Image link"
                placeholder="https://… a link that opens straight to an image"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button variant="outline" loading={busy === "link"} disabled={!link.trim() || full || busy !== null} onClick={importLink}>
                Add
              </Button>
            </div>
            <p className="text-[13px] text-muted">
              Instagram and Facebook post pages block downloads. For those, take a screenshot and upload it.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
