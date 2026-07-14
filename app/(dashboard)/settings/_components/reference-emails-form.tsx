"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Field,
  Input,
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";
import type { ReferenceEmail } from "@/lib/db/types";

/**
 * The reference email library (Settings → Reference emails): paste or upload
 * full emails you want yours to read like. Each save runs a one-time style
 * analysis; the distilled traits steer every email generation from then on.
 */
export function ReferenceEmailsForm() {
  const [references, setReferences] = useState<ReferenceEmail[] | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reference-emails")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setReferences(data.references ?? []);
      })
      .catch(() => {
        if (!cancelled) setReferences([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFile(file: File) {
    file
      .text()
      .then((text) => {
        setContent(text);
        if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
      })
      .catch(() => toast.error("Couldn't read that file."));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/reference-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setReferences((refs) => [data.reference, ...(refs ?? [])]);
      setName("");
      setContent("");
      toast.success("Saved. New emails will match this style.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/reference-emails/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setReferences((refs) => (refs ?? []).filter((r) => r.id !== id));
      toast.success("Removed.");
    } catch {
      toast.error("Failed to remove.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field
          label="Name"
          hint="What to call this reference, e.g. 'April promo I loved'."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly newsletter, the good one"
          />
        </Field>

        <Field
          label="The email"
          hint="Paste the full email (plain text or HTML both work), or upload a .txt / .html / .eml file."
        >
          <Textarea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the whole email here…"
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button
            variant="gradient"
            loading={saving}
            disabled={!name.trim() || content.trim().length < 100}
            onClick={handleSave}
          >
            {saving ? "Analyzing style…" : "Save reference"}
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            Upload file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.html,.htm,.eml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      {references === null ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : references.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          No reference emails yet. The first one you add is the single biggest
          upgrade you can give your drafts.
        </p>
      ) : (
        <div className="space-y-3">
          {references.map((ref) => (
            <Card key={ref.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {ref.name}
                  </p>
                  <p className="text-xs text-muted">
                    Added {new Date(ref.created_at).toLocaleDateString()}
                    {ref.style_profile?.approx_words
                      ? ` · ~${ref.style_profile.approx_words} words`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deletingId === ref.id}
                  onClick={() => handleDelete(ref.id)}
                >
                  Remove
                </Button>
              </div>
              {ref.style_profile?.summary && (
                <p className="text-sm leading-relaxed text-muted">
                  {ref.style_profile.summary}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
