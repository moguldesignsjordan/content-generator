"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";

/** First-run: no brand exists yet. Create one (name only) to start onboarding. */
export function CreateBrandForm() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError("Couldn't create the brand. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-semibold">Start your brand profile</h2>
      <p className="mt-1.5 text-sm text-muted">
        You&apos;ll walk through the basics, then how your brand looks and sounds.
        Everything is editable later in Settings.
      </p>
      <div className="mt-5">
        <Field label="Brand name">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="e.g. Mogul Design Agency"
          />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <Button
        variant="gradient"
        className="mt-5"
        loading={saving}
        disabled={!name.trim()}
        onClick={handleCreate}
      >
        {saving ? "Creating…" : "Start onboarding"}
      </Button>
    </Card>
  );
}
