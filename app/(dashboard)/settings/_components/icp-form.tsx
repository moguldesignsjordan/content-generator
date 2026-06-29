"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
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
    <Card className="space-y-5 p-5">
      <Field label="ICP label">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>

      <Field
        label="Demographics"
        hint="Who they are, role, company size, revenue stage."
      >
        <Textarea
          rows={3}
          value={demographics}
          onChange={(e) => setDemographics(e.target.value)}
        />
      </Field>

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
        hint="Words and phrases they actually use, not your jargon, theirs."
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

      <Field
        label="Awareness stage"
        hint="How aware are they of the problem and solution?"
      >
        <Input
          value={awarenessStage}
          onChange={(e) => setAwarenessStage(e.target.value)}
          placeholder="e.g. problem/solution-aware, low product-awareness"
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save ICP
        </Button>
        {status === "saved" && <span className="text-sm text-success">Saved</span>}
        {status === "error" && (
          <span className="text-sm text-danger">Failed to save.</span>
        )}
      </div>
    </Card>
  );
}
