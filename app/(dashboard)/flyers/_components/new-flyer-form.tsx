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
import { cn } from "@/lib/cn";
import { toastApiError } from "@/lib/billing/toast-error";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import { StylePicker, type StyleOption } from "./style-library";
import { useImageModelOptions } from "../../_components/image-models-context";
import { LookPicker } from "../../_components/look-picker";

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

export interface CompetitorAdOption {
  id: string;
  name: string;
}

type Source = "topic" | "brief";

export function NewFlyerForm({
  topics,
  styles,
  competitorAds,
}: {
  topics: FlyerTopicOption[];
  styles: StyleOption[];
  competitorAds: CompetitorAdOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [source, setSource] = useState<Source>(topics.length ? "topic" : "brief");
  const [topicId, setTopicId] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [styleId, setStyleId] = useState("");
  const [presetStyle, setPresetStyle] = useState("");
  const [competitorId, setCompetitorId] = useState("");
  const [format, setFormat] = useState<"post" | "ad">("post");
  // "" = the brand's default model (Settings).
  const imageModelOptions = useImageModelOptions();
  const [model, setModel] = useState("");
  const [lookId, setLookId] = useState<string | null>(null);
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
          style: presetStyle || undefined,
          competitorReferenceId: competitorId || undefined,
          format,
          model: model || undefined,
          ...(lookId ? { lookId } : {}),
        }),
      });
      const data = (await res.json()) as {
        draftId?: string;
        error?: string;
        outOfCredits?: boolean;
        upgradeUrl?: string;
      };
      if (!res.ok || !data.draftId) {
        toastApiError(toast, data, "Generation failed.");
        setBusy(false);
        return;
      }
      router.push(`/drafts/${data.draftId}`);
    } catch {
      toast.error("Generation failed.");
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

        <Field
          label="Use it as"
          hint={
            format === "ad"
              ? "Writes the ad's primary text, headline, description, and CTA button to paste into Ads Manager."
              : "Writes a caption and hashtags to post with the image."
          }
        >
          <SegmentedControl
            value={format}
            onChange={setFormat}
            options={[
              { value: "post", label: "Organic post" },
              { value: "ad", label: "Paid ad" },
            ]}
          />
        </Field>

        {competitorAds.length > 0 && (
          <Field
            label="Inspired by a competitor ad (optional)"
            hint="Borrows its hook, structure, and layout idea. The words, offer, and imagery stay yours."
          >
            <Select
              value={competitorId}
              onChange={(e) => setCompetitorId(e.target.value)}
              disabled={busy}
            >
              <option value="">None</option>
              {competitorAds.map((ad) => (
                <option key={ad.id} value={ad.id}>
                  {ad.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Post shape">
          <SegmentedControl
            value={aspect}
            onChange={setAspect}
            options={ASPECT_OPTIONS}
          />
        </Field>

        <Field
          label="Image model"
          hint={`${
            imageModelOptions.find((m) => m.id === model)?.description ??
            "Uses the model picked in Settings."
          } Four options are made, so a flyer costs four images.`}
        >
          <Select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
            <option value="">My default</option>
            {imageModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Make it look like">
          <LookPicker value={lookId} onChange={setLookId} disabled={busy} />
        </Field>

        <Field label="Design style">
          <div className="flex flex-wrap gap-2">
            <PresetChip
              active={presetStyle === ""}
              disabled={busy}
              onClick={() => setPresetStyle("")}
            >
              Surprise me
            </PresetChip>
            {FLYER_STYLE_CATALOG.map((s) => (
              <PresetChip
                key={s.id}
                active={presetStyle === s.id}
                disabled={busy}
                onClick={() => {
                  setPresetStyle(s.id);
                  // A preset and an uploaded reference fight each other (the
                  // reference wins in the pipeline), so picking one clears
                  // the other.
                  setStyleId("");
                }}
              >
                {s.label}
              </PresetChip>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {presetStyle
              ? FLYER_STYLE_CATALOG.find((s) => s.id === presetStyle)?.description
              : "A different design direction each time."}
          </p>
        </Field>

        <Field
          label="Or match an uploaded style (optional)"
          hint="Upload flyers or designs you like once; new flyers can match their look. Picking one overrides the design style above."
        >
          <StylePicker
            initialStyles={styles}
            value={styleId}
            onChange={(id) => {
              setStyleId(id);
              if (id) setPresetStyle("");
            }}
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

function PresetChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50",
        active
          ? "border-accent bg-accent/10 text-foreground"
          : "border-border text-muted hover:border-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
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
