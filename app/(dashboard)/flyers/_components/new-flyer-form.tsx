"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { StylePicker, type StyleOption } from "./style-library";

// Aspect labels mirror FLYER_ASPECTS in prompts/generate-flyer.ts; kept
// inline (not imported) because that module is part of the server prompt
// layer and this is a client component.
const ASPECT_OPTIONS = [
  { value: "1:1", label: "Square 1:1" },
  { value: "4:5", label: "Portrait 4:5" },
  { value: "9:16", label: "Story 9:16" },
];

export interface FlyerTopicOption {
  id: string;
  title: string;
  pillar: string;
}

type Source = "topic" | "brief";

export function NewFlyerForm({
  topics,
  styles,
}: {
  topics: FlyerTopicOption[];
  styles: StyleOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [source, setSource] = useState<Source>(topics.length ? "topic" : "brief");
  const [topicId, setTopicId] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [styleId, setStyleId] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit =
    source === "topic" ? Boolean(topicId) : Boolean(title.trim());

  async function generate() {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/flyers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(source === "topic"
            ? { topicId }
            : { title: title.trim(), brief: brief.trim() || undefined }),
          ...(source === "topic" && brief.trim() ? { brief: brief.trim() } : {}),
          aspect,
          styleReferenceId: styleId || undefined,
        }),
      });
      const data = (await res.json()) as { draftId?: string; error?: string };
      if (!res.ok || !data.draftId) throw new Error(data.error ?? "Generation failed.");
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
      setBusy(false);
    }
  }

  const grouped = groupByPillar(topics);

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4">
        <SegmentedControl
          value={source}
          onChange={(v) => setSource(v as Source)}
          options={[
            { value: "topic", label: "From a topic" },
            { value: "brief", label: "From a brief" },
          ]}
        />

        {source === "topic" ? (
          <Field label="Topic">
            <Select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={busy}
            >
              <option value="">Pick a topic…</option>
              {grouped.map(([pillar, ts]) => (
                <optgroup key={pillar} label={pillar || "Topics"}>
                  {ts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="What's the flyer about?">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer website special: 20% off new builds"
              disabled={busy}
              maxLength={140}
            />
          </Field>
        )}

        <Field label="Creative brief (optional)">
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Anything specific: the offer, the vibe, what to emphasize…"
            rows={3}
            disabled={busy}
          />
        </Field>

        <Field label="Post shape">
          <SegmentedControl
            value={aspect}
            onChange={setAspect}
            options={ASPECT_OPTIONS}
          />
        </Field>

        <Field
          label="Style (optional)"
          hint="Upload flyers or designs you like once; new flyers can match their look."
        >
          <StylePicker
            initialStyles={styles}
            value={styleId}
            onChange={setStyleId}
            disabled={busy}
          />
        </Field>

        <div>
          <Button
            variant="gradient"
            size="md"
            onClick={generate}
            loading={busy}
            disabled={!canSubmit || busy}
          >
            Design flyer
          </Button>
        </div>
      </div>
    </Card>
  );
}

function groupByPillar(
  topics: FlyerTopicOption[],
): [string, FlyerTopicOption[]][] {
  const map = new Map<string, FlyerTopicOption[]>();
  for (const t of topics) {
    const arr = map.get(t.pillar) ?? [];
    arr.push(t);
    map.set(t.pillar, arr);
  }
  return Array.from(map.entries());
}
