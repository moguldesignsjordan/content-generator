"use client";

import { useState } from "react";
import { Button, Card, Field, Input, useToast } from "@/components/ui";
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
  const toast = useToast();

  async function handleSave() {
    if (!brandName.trim()) return;
    setSaving(true);
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
      toast.success("Saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <Field
        label="Brand name"
        hint="Shown in the dashboard header and used to sign generated content."
      >
        <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
      </Field>

      <Field
        label="Sender name"
        hint="Who emails appear to come from, shown in the recipient's inbox."
      >
        <Input
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="e.g. Jordan at Mogul Design"
        />
      </Field>

      <Field label="Sender email" hint="Reply-to address for email campaigns.">
        <Input
          type="email"
          value={senderEmail}
          onChange={(e) => setSenderEmail(e.target.value)}
          placeholder="e.g. jordan@moguldesignagency.com"
        />
      </Field>

      <Field
        label="SEO geography"
        hint="Default market for keyword research and search intent targeting."
      >
        <Input
          value={geography}
          onChange={(e) => setGeography(e.target.value)}
          placeholder="e.g. US"
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="gradient"
          loading={saving}
          disabled={!brandName.trim()}
          onClick={handleSave}
        >
          Save basics
        </Button>
      </div>
    </Card>
  );
}
