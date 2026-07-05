"use client";

import { useRef, useState } from "react";
import { Button, Card, Field, Input, Label, useToast } from "@/components/ui";
import type { BrandColors, BrandFonts, VisualIdentity } from "@/lib/db/types";

interface VisualIdentityFormProps {
  brandId: string;
  visualIdentity: VisualIdentity;
  brandName: string;
}

const COLOR_FIELDS: { key: keyof BrandColors; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent (CTA)" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted" },
];

export function VisualIdentityForm({
  brandId,
  visualIdentity,
  brandName,
}: VisualIdentityFormProps) {
  // Guard: a brand row seeded before these columns existed (or before re-seed)
  // returns undefined, so default to an empty object.
  const vi = visualIdentity ?? {};
  const initialColors = vi.colors ?? {};
  const initialFonts = vi.fonts ?? {};
  const initialFooter = vi.footer ?? {};
  const initialSocial = initialFooter.social ?? {};

  const [logoUrl, setLogoUrl] = useState(vi.logo_url ?? "");
  const [logoAlt, setLogoAlt] = useState(vi.logo_alt ?? brandName);
  const [colors, setColors] = useState<BrandColors>(initialColors);
  const [fonts, setFonts] = useState<BrandFonts>(initialFonts);
  const [contactEmail, setContactEmail] = useState(
    initialFooter.contact_email ?? "",
  );
  const [website, setWebsite] = useState(initialFooter.website ?? "");
  const [social, setSocial] = useState(initialSocial);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/upload-logo", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Upload failed");
      }
      setLogoUrl(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/visual-identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          visualIdentity: {
            logo_url: logoUrl.trim() || undefined,
            logo_alt: logoAlt.trim() || undefined,
            colors,
            fonts,
            footer: {
              contact_email: contactEmail.trim() || undefined,
              website: website.trim() || undefined,
              social,
            },
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-6 p-5">
      {/* Logo */}
      <div>
        <Label>Logo</Label>
        <p className="-mt-1 mb-2 text-xs text-muted">
          PNG, JPG, WebP, or SVG. Max 2MB. Stored in Supabase.
        </p>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={logoAlt}
              className="h-14 max-w-[180px] rounded-[var(--radius-md)] border border-border bg-background object-contain p-1"
            />
          ) : (
            <div className="flex h-14 w-28 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border text-xs text-muted">
              No logo
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="subtle"
              size="sm"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {logoUrl ? "Replace" : "Upload"}
            </Button>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="text-xs text-muted transition-colors hover:text-danger"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Colors */}
      <div>
        <Label>Brand colors</Label>
        <p className="-mt-1 mb-2 text-xs text-muted">
          Hex values. Accent drives the CTA button.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COLOR_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <span className="text-xs text-muted">{label}</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={normalizeHex(colors[key])}
                  onChange={(e) =>
                    setColors({ ...colors, [key]: e.target.value })
                  }
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-background p-0.5"
                  aria-label={`${label} color`}
                />
                <Input
                  value={colors[key] ?? ""}
                  onChange={(e) =>
                    setColors({ ...colors, [key]: e.target.value })
                  }
                  placeholder="#0F172A"
                  className="font-mono text-[13px]"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fonts */}
      <div>
        <Label>Typography</Label>
        <p className="-mt-1 mb-2 text-xs text-muted">
          CSS font-family strings, e.g. <code>Georgia, serif</code>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Headings">
            <Input
              value={fonts.heading ?? ""}
              onChange={(e) => setFonts({ ...fonts, heading: e.target.value })}
              placeholder="Georgia, serif"
              className="font-mono text-[13px]"
            />
          </Field>
          <Field label="Body">
            <Input
              value={fonts.body ?? ""}
              onChange={(e) => setFonts({ ...fonts, body: e.target.value })}
              placeholder="Inter, system-ui, sans-serif"
              className="font-mono text-[13px]"
            />
          </Field>
        </div>
      </div>

      {/* Footer / contact */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contact email">
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="hello@yourbrand.com"
          />
        </Field>
        <Field label="Website">
          <Input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourbrand.com"
          />
        </Field>
      </div>

      {/* Social */}
      <div>
        <Label>Social links</Label>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["linkedin", "twitter", "instagram", "youtube"] as const).map(
            (k) => (
              <Input
                key={k}
                value={social[k] ?? ""}
                onChange={(e) => setSocial({ ...social, [k]: e.target.value })}
                placeholder={`${k[0].toUpperCase()}${k.slice(1)} URL`}
              />
            ),
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save visual identity
        </Button>
      </div>
    </Card>
  );
}

/** `<input type=color>` requires a 7-char #rrggbb; fall back gracefully. */
function normalizeHex(v?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v ?? "") ? (v as string) : "#000000";
}
