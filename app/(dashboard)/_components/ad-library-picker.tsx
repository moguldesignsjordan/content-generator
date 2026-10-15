"use client";

import { useEffect, useState } from "react";
import { AccentSpinner } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { AdLibraryAd } from "@/lib/clients/scrapecreators";

type PreviewAd = AdLibraryAd & { saved: boolean };

// Matches MAX_ADS in the save route: each saved ad is one Claude call.
const MAX_PICKED = 10;

/**
 * The chat's version of the Media page's Ad Library import: loads an
 * advertiser's top ads through the same preview route, saves the ticked ones
 * through the same save route, then hands back the first one ticked, which
 * the agent attaches to the piece being made.
 */
export function AdLibraryPicker({
  url,
  onDone,
}: {
  url: string;
  /** Ad archive ids in the order they were ticked. */
  onDone: (adIds: string[]) => void;
}) {
  const [ads, setAds] = useState<PreviewAd[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An array, not a Set: the first one ticked is the one used for this piece.
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/competitor-references/ad-library/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { ads?: PreviewAd[]; error?: string };
        if (!res.ok || !data.ads) throw new Error(data.error ?? "Couldn't load that page's ads.");
        if (!cancelled) setAds(data.ads);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load that page's ads.");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  function toggle(id: string) {
    setPicked((cur) =>
      cur.includes(id)
        ? cur.filter((p) => p !== id)
        : cur.length < MAX_PICKED
          ? [...cur, id]
          : cur,
    );
  }

  async function save() {
    if (!ads || picked.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const toSave = ads.filter((ad) => picked.includes(ad.adArchiveId) && !ad.saved);
      if (toSave.length) {
        const res = await fetch("/api/competitor-references/ad-library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ads: toSave }),
        });
        const data = (await res.json()) as { savedIds?: string[]; error?: string };
        if (!res.ok || !data.savedIds) throw new Error(data.error ?? "Couldn't save those ads.");
        const ok = new Set([
          ...data.savedIds,
          ...ads.filter((ad) => ad.saved).map((ad) => ad.adArchiveId),
        ]);
        const kept = picked.filter((id) => ok.has(id));
        if (!kept.length) throw new Error("Couldn't save those ads. Try again.");
        onDone(kept);
      } else {
        onDone(picked);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save those ads.");
      setSaving(false);
    }
  }

  if (error && !ads) return <p className="text-[13px] text-danger">{error}</p>;
  if (!ads) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <AccentSpinner size={14} /> Loading their top ads
      </p>
    );
  }
  if (ads.length === 0) {
    return <p className="text-[13px] text-muted">That page has no ads running right now.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {ads.map((ad) => {
          const order = picked.indexOf(ad.adArchiveId);
          return (
            <button
              key={ad.adArchiveId}
              type="button"
              aria-pressed={order >= 0}
              disabled={ad.isTemplate || saving}
              onClick={() => toggle(ad.adArchiveId)}
              className={cn(
                "relative flex w-36 shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-md)] border bg-surface text-left transition-colors disabled:opacity-50",
                order >= 0 ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong",
              )}
            >
              {ad.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ad.imageUrl}
                  alt={ad.headline || "Ad image"}
                  className="aspect-square w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center bg-surface-2 text-[11px] text-muted">
                  Text ad
                </span>
              )}
              {order >= 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                  {order === 0 ? <CheckIcon size={12} /> : order + 1}
                </span>
              )}
              <span className="line-clamp-3 px-2 pt-1.5 text-[12px] leading-snug text-foreground">
                {ad.headline || ad.bodyText || "No text"}
              </span>
              <span className="mt-auto px-2 pb-1.5 pt-1 text-[11px] text-muted">
                {ad.isTemplate ? "Catalog ad" : ad.saved ? "Saved" : ad.isVideo ? "Video" : ad.ctaText}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={picked.length === 0 || saving}
          onClick={() => void save()}
          className="flex items-center gap-2 rounded-full border border-accent bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-press disabled:opacity-50"
        >
          {saving && <AccentSpinner size={14} />}
          {saving
            ? "Studying them"
            : picked.length
              ? `Use ${picked.length} ad${picked.length === 1 ? "" : "s"}`
              : "Tick ads to use"}
        </button>
        {picked.length > 1 && !saving && (
          <span className="text-[12px] text-muted">The one with the check shapes this piece.</span>
        )}
      </div>
    </div>
  );
}
