"use client";

import { useEffect, useRef, useState } from "react";
import { AccentSpinner, Button, Checkbox, Input, useToast } from "@/components/ui";
import type { Product, ProposedProduct } from "@/lib/db/types";

type Row = ProposedProduct & { include: boolean };

/**
 * Products from the owner's website, to tick and save: photo, name, and
 * price per row (prices often render in the browser, so they come in blank
 * and are typed here). Nothing is saved until "Add". Used in Settings >
 * Products and inline in the Create chat.
 */
export function ProductImport({
  brandId,
  website,
  existing,
  autoStart = false,
  onSaved,
}: {
  brandId: string;
  website: string;
  existing: Pick<Product, "slug">[];
  /** Start reading the site right away (the chat, where the site is known). */
  autoStart?: boolean;
  onSaved: (saved: Product[]) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState(website);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function find(target: string) {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch("/api/settings/import-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target.trim() ? { url: target.trim() } : {}),
      });
      const data = (await res.json()) as { products?: ProposedProduct[]; error?: string };
      if (!res.ok || !data.products) throw new Error(data.error ?? "Couldn't read the products.");
      if (!data.products.length) throw new Error("No products found on that site. You can add them by hand.");
      setRows(data.products.map((p) => ({ ...p, include: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the products.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void find(website);
    // Runs once on mount; find reads the website it was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(i: number, changes: Partial<Row>) {
    setRows((cur) => cur?.map((r, j) => (j === i ? { ...r, ...changes } : r)) ?? null);
  }

  async function save() {
    const picked = rows?.filter((r) => r.include && r.name.trim()) ?? [];
    if (!picked.length) return;
    setSaving(true);
    const saved: Product[] = [];
    let photoSkipped = 0;
    for (const row of picked) {
      const res = await fetch("/api/settings/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          product: {
            slug: row.slug,
            name: row.name.trim(),
            description: row.description,
            deliverables: row.deliverables,
            price_point: row.price_point,
            url: row.url,
            image_url: row.image_url,
          },
        }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { product?: Product; photoSkipped?: boolean };
      if (res?.ok && data.product) saved.push(data.product);
      if (data?.photoSkipped) photoSkipped++;
    }
    setSaving(false);
    if (saved.length < picked.length) toast.error(`Saved ${saved.length} of ${picked.length}. Try the rest again.`);
    else toast.success(`Added ${saved.length} product${saved.length === 1 ? "" : "s"}.`);
    if (photoSkipped) toast.error(`${photoSkipped} photo${photoSkipped === 1 ? "" : "s"} couldn't be copied. Upload them by hand.`);
    if (saved.length) {
      setRows((cur) => cur?.filter((r) => !saved.some((s) => s.slug === r.slug)) ?? null);
      onSaved(saved);
    }
  }

  const count = rows?.filter((r) => r.include).length ?? 0;

  return (
    <div className="space-y-3">
      {!autoStart && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Website"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yoursite.com"
            className="flex-1"
          />
          <Button variant="subtle" loading={loading} onClick={() => void find(url)} disabled={!url.trim()}>
            Find products
          </Button>
        </div>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <AccentSpinner size={14} /> Reading your site&apos;s products. This can take up to a minute.
        </p>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {rows && rows.length > 0 && (
        <>
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li
                key={row.slug}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border p-2.5"
              >
                <Checkbox
                  aria-label={`Add ${row.name}`}
                  checked={row.include}
                  onChange={(e) => patch(i, { include: e.target.checked })}
                />
                {row.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.image_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] border border-border object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-border text-[10px] text-muted">
                    No photo
                  </span>
                )}
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_9rem]">
                  <Input
                    aria-label="Name"
                    value={row.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                  <Input
                    aria-label="Price"
                    value={row.price_point ?? ""}
                    onChange={(e) => patch(i, { price_point: e.target.value })}
                    placeholder="Price"
                  />
                </div>
                {existing.some((e) => e.slug === row.slug) && (
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">updates existing</span>
                )}
              </li>
            ))}
          </ul>
          <Button variant="gradient" size="sm" loading={saving} disabled={!count} onClick={() => void save()}>
            {count ? `Add ${count} product${count === 1 ? "" : "s"}` : "Tick products to add"}
          </Button>
        </>
      )}
    </div>
  );
}
