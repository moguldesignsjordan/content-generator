"use client";

import { useState } from "react";
import type { Icp } from "@/lib/db/types";
import { ListInput } from "./list-input";

export function IcpForm({ icp }: { icp: Icp }) {
  const p = icp.profile;
  const [label, setLabel] = useState(icp.label);
  const [demographics, setDemographics] = useState(p.demographics ?? "");
  const [pains, setPains] = useState<string[]>(p.pains ?? []);
  const [objections, setObjections] = useState<string[]>(p.objections ?? []);
  const [vocabulary, setVocabulary] = useState<string[]>(p.vocabulary ?? []);
  const [jtbd, setJtbd] = useState<string[]>(p.jobs_to_be_done ?? []);
  const [triggers, setTriggers] = useState<string[]>(p.triggers ?? []);
  const [awarenessStage, setAwarenessStage] = useState(p.awareness_stage ?? "");

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch(`/api/settings/icp/${icp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          profile: {
            ...p,
            demographics,
            pains: pains.filter(Boolean),
            objections: objections.filter(Boolean),
            vocabulary: vocabulary.filter(Boolean),
            jobs_to_be_done: jtbd.filter(Boolean),
            triggers: triggers.filter(Boolean),
            awareness_stage: awarenessStage,
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
      <div>
        <label className="text-xs uppercase tracking-wide text-muted">ICP label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={`mt-2 ${inputCls}`}
        />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">Demographics</label>
        <p className="mt-0.5 text-xs text-muted">Who they are — role, company size, revenue stage.</p>
        <textarea
          value={demographics}
          onChange={(e) => setDemographics(e.target.value)}
          rows={3}
          className={`mt-2 ${inputCls}`}
        />
      </div>

      <ListInput
        label="Pains"
        hint="Their real frustrations in their own words. The more specific, the better the copy."
        values={pains}
        onChange={setPains}
        placeholder="e.g. brand looks DIY / amateur"
      />

      <ListInput
        label="Objections"
        hint="Reasons they hesitate to buy. Claude uses these to pre-empt resistance."
        values={objections}
        onChange={setObjections}
        placeholder="e.g. agencies are too expensive"
      />

      <ListInput
        label="Vocabulary"
        hint="Words and phrases they actually use — not your jargon, theirs."
        values={vocabulary}
        onChange={setVocabulary}
        placeholder="e.g. rebrand, visual identity, look professional"
      />

      <ListInput
        label="Jobs to be done"
        hint="What they're hiring you to accomplish."
        values={jtbd}
        onChange={setJtbd}
        placeholder="e.g. look as credible as we actually are"
      />

      <ListInput
        label="Buying triggers"
        hint="Events that push them into action."
        values={triggers}
        onChange={setTriggers}
        placeholder="e.g. raising a funding round"
      />

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">Awareness stage</label>
        <p className="mt-0.5 text-xs text-muted">How aware are they of the problem and solution?</p>
        <input
          type="text"
          value={awarenessStage}
          onChange={(e) => setAwarenessStage(e.target.value)}
          placeholder="e.g. problem/solution-aware, low product-awareness"
          className={`mt-2 ${inputCls}`}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save ICP"}
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

const inputCls =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none resize-y";
