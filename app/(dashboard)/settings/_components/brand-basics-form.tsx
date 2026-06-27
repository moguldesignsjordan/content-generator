"use client";

import { useState } from "react";
import type { MailerliteConfig, SeoDefaults } from "@/lib/db/types";

interface BrandBasicsFormProps {
  brandId: string;
  name: string;
  mailerliteConfig: MailerliteConfig;
  seoDefaults: SeoDefaults;
}

export function BrandBasicsForm({
  brandId,
  name,
  mailerliteConfig,
  seoDefaults,
}: BrandBasicsFormProps) {
  const [brandName, setBrandName] = useState(name);
  const [senderName, setSenderName] = useState(mailerliteConfig.sender_name ?? "");
  const [senderEmail, setSenderEmail] = useState(mailerliteConfig.sender_email ?? "");
  const [geography, setGeography] = useState(seoDefaults.geography ?? "");

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    if (!brandName.trim()) return;
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/settings/brand-basics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: brandName,
          // Round-trip non-UI fields so they aren't silently dropped.
          mailerlite_config: {
            ...mailerliteConfig,
            sender_name: senderName,
            sender_email: senderEmail,
          },
          seo_defaults: {
            ...seoDefaults,
            geography,
          },
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
      <Field label="Brand name" hint="Shown in the dashboard header and used to sign generated content.">
        <input
          type="text"
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="Sender name" hint="Who emails appear to come from — shown in the recipient's inbox.">
        <input
          type="text"
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="e.g. Jordan at Mogul Design"
          className={inputCls}
        />
      </Field>

      <Field label="Sender email" hint="Reply-to address for email campaigns.">
        <input
          type="email"
          value={senderEmail}
          onChange={(e) => setSenderEmail(e.target.value)}
          placeholder="e.g. jordan@moguldesignagency.com"
          className={inputCls}
        />
      </Field>

      <Field label="SEO geography" hint="Default market for keyword research and search intent targeting.">
        <input
          type="text"
          value={geography}
          onChange={(e) => setGeography(e.target.value)}
          placeholder="e.g. US"
          className={inputCls}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !brandName.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save basics"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-emerald-400">Saved ✓</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">Failed to save.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none";
