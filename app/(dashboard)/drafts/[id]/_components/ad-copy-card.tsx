"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Select, Sheet, Textarea, useToast } from "@/components/ui";
import { AD_CTA_BUTTONS, type AdCopy, type FlyerCopy } from "@/lib/db/types";

// Rough cut-off for primary text before Meta adds "See more" in the feed.
const PRIMARY_TEXT_VISIBLE = 125;

/**
 * The text fields of an ad-format flyer (meta.flyer_format = "ad"), laid out
 * like the feed: primary text above the image, headline/description/button
 * below. Each field copies on its own, since Ads Manager has a box per field.
 * Edits go through the flyer route's "ad_copy" mode: plain text, no AI.
 */
export function AdCopyCard({
  draftId,
  ad,
  editable,
  onSaved,
}: {
  draftId: string;
  ad: AdCopy;
  editable: boolean;
  onSaved: (copy: FlyerCopy) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdCopy>(ad);
  const [saving, setSaving] = useState(false);

  async function copyField(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Couldn't copy the ${label.toLowerCase()}.`);
    }
  }

  async function handleSave() {
    if (!draft.primary_text.trim() || !draft.headline.trim() || saving) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("mode", "ad_copy");
      form.set("primary_text", draft.primary_text.trim());
      form.set("headline", draft.headline.trim());
      form.set("description", draft.description?.trim() ?? "");
      form.set("cta_button", draft.cta_button);
      const res = await fetch(`/api/drafts/${draftId}/flyer`, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { copy?: FlyerCopy; error?: string };
      if (!res.ok || !data.copy) throw new Error(data.error ?? "Failed to save.");
      onSaved(data.copy);
      setOpen(false);
      toast.success("Ad text saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const overflow = ad.primary_text.length > PRIMARY_TEXT_VISIBLE;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Ad text</h3>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(ad);
              setOpen(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>

      <AdField label="Primary text" onCopy={() => void copyField(ad.primary_text, "Primary text")}>
        <p className="whitespace-pre-wrap text-sm text-foreground/90">{ad.primary_text}</p>
        {overflow && (
          <p className="mt-1 text-xs text-muted">
            Only about the first {PRIMARY_TEXT_VISIBLE} characters show before &quot;See more&quot;.
          </p>
        )}
      </AdField>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{ad.headline}</p>
          {ad.description && <p className="truncate text-xs text-muted">{ad.description}</p>}
        </div>
        <span className="shrink-0 rounded-md bg-foreground/10 px-3 py-1.5 text-[13px] font-medium text-foreground">
          {ad.cta_button}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void copyField(ad.headline, "Headline")}>
          Copy headline
        </Button>
        {ad.description && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyField(ad.description!, "Description")}
          >
            Copy description
          </Button>
        )}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Edit ad text"
        description="What goes into each Ads Manager field."
        footer={
          <div className="flex gap-2">
            <Button variant="subtle" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={saving}
              disabled={!draft.primary_text.trim() || !draft.headline.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field
            label="Primary text"
            hint={`${draft.primary_text.length} characters. About ${PRIMARY_TEXT_VISIBLE} show before "See more".`}
          >
            <Textarea
              rows={5}
              value={draft.primary_text}
              onChange={(e) => setDraft({ ...draft, primary_text: e.target.value })}
            />
          </Field>
          <Field label="Headline" hint="About 40 characters.">
            <Input
              value={draft.headline}
              onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
            />
          </Field>
          <Field label="Description (optional)" hint="About 30 characters.">
            <Input
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          <Field label="Button">
            <Select
              value={draft.cta_button}
              onChange={(e) =>
                setDraft({ ...draft, cta_button: e.target.value as AdCopy["cta_button"] })
              }
            >
              {AD_CTA_BUTTONS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sheet>
    </Card>
  );
}

function AdField({
  label,
  onCopy,
  children,
}: {
  label: string;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          Copy
        </Button>
      </div>
      {children}
    </div>
  );
}
