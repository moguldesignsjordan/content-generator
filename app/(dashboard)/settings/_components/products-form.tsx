"use client";

import { useRef, useState } from "react";
import { Button, Card, Field, Input, Textarea, useToast } from "@/components/ui";
import type { Product } from "@/lib/db/types";
import { ListInput } from "./list-input";

interface ProductsFormProps {
  brandId: string;
  products: Product[];
}

interface EditableProduct {
  id: string | null; // null → not yet saved
  slug: string;
  name: string;
  description: string;
  deliverables: string[];
  price_point: string;
  url: string;
  image_url: string;
}

function toEditable(p: Product): EditableProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? "",
    deliverables: p.deliverables ?? [],
    price_point: p.price_point ?? "",
    url: p.url ?? "",
    image_url: p.image_url ?? "",
  };
}

const EMPTY: EditableProduct = {
  id: null,
  slug: "",
  name: "",
  description: "",
  deliverables: [],
  price_point: "",
  url: "",
  image_url: "",
};

/**
 * The offers behind topics.maps_to_product. What's written here is exactly
 * what generation pitches, so real scope and pricing beats placeholder copy.
 */
export function ProductsForm({ brandId, products }: ProductsFormProps) {
  const [items, setItems] = useState<EditableProduct[]>(products.map(toEditable));

  function patch(index: number, changes: Partial<EditableProduct>) {
    setItems((cur) =>
      cur.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <ProductCard
          key={item.id ?? `new-${i}`}
          brandId={brandId}
          product={item}
          onChange={(changes) => patch(i, changes)}
          onSaved={(saved) => patch(i, { id: saved.id })}
          onDeleted={() => setItems((cur) => cur.filter((_, j) => j !== i))}
        />
      ))}

      <Button
        variant="subtle"
        onClick={() => setItems((cur) => [...cur, { ...EMPTY }])}
      >
        + Add product
      </Button>
    </div>
  );
}

function ProductCard({
  brandId,
  product,
  onChange,
  onSaved,
  onDeleted,
}: {
  brandId: string;
  product: EditableProduct;
  onChange: (changes: Partial<EditableProduct>) => void;
  onSaved: (saved: Product) => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const toast = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);

  async function handlePhotoUpload(file: File) {
    setUploadingPhoto(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uploads/image", { method: "POST", body });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      onChange({ image_url: data.url });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, product }),
      });
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok || !data.product) throw new Error(data.error);
      onSaved(data.product);
      toast.success("Saved.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product.id) {
      onDeleted();
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/settings/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      if (!res.ok) throw new Error();
      onDeleted();
    } catch {
      toast.error("Something went wrong.");
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={product.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Brand Identity System"
          />
        </Field>
        <Field
          label="Slug"
          hint="Topics point at this (maps_to_product). Changing it breaks the link."
        >
          <Input
            value={product.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            placeholder="e.g. brand-identity-service"
          />
        </Field>
      </div>

      <Field
        label="Description"
        hint="What generation pitches. Real scope beats placeholder copy."
      >
        <Textarea
          rows={3}
          value={product.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>

      <ListInput
        label="Deliverables"
        values={product.deliverables}
        onChange={(deliverables) => onChange({ deliverables })}
        placeholder="Add a deliverable…"
      />

      <Field
        label="Photo"
        hint="A real photo of this product. Product emails offer it as the hero image instead of an AI-generated one."
      >
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePhotoUpload(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-3">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-[var(--radius-md)] border border-border object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border text-[10px] text-muted">
              No photo
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="subtle"
              size="sm"
              loading={uploadingPhoto}
              onClick={() => photoInputRef.current?.click()}
            >
              {product.image_url ? "Replace" : "Upload"}
            </Button>
            {product.image_url && (
              <button
                type="button"
                onClick={() => onChange({ image_url: "" })}
                className="text-xs text-muted transition-colors hover:text-danger"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price point" hint="How pricing is talked about in copy.">
          <Input
            value={product.price_point}
            onChange={(e) => onChange({ price_point: e.target.value })}
            placeholder="e.g. Starting at $7,500"
          />
        </Field>
        <Field label="Link" hint="Where the CTA can point.">
          <Input
            value={product.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="gradient"
          size="sm"
          loading={saving}
          onClick={handleSave}
          disabled={!product.name.trim() || !product.slug.trim()}
        >
          Save product
        </Button>
        <Button
          variant="subtle"
          size="sm"
          loading={deleting}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}
