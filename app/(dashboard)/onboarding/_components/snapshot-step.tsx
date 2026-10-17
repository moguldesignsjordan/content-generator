"use client";

import { useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Badge, Button, Card, Checkbox, Field, Input, Textarea, useToast } from "@/components/ui";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import {
  MAIN_ACTION_KINDS,
  type BrandColors,
  type OnboardingProposal,
  type ProposedProduct,
} from "@/lib/db/types";
import { answerGap, gapQuestions, MAIN_ACTION_LABELS, type GapId } from "@/lib/onboarding/checklist";
import { mainActionLine } from "@/lib/onboarding/proposal";
import { slugify } from "@/lib/text";
import { StepChip } from "../../_components/question-card";
import { StickyAction } from "./sticky-action";

const COLOR_ROLES: { key: keyof BrandColors; label: string }[] = [
  { key: "primary", label: "Main" },
  { key: "accent", label: "Buttons" },
  { key: "secondary", label: "Second" },
];

/** Picks which of a list are kept: everything starts ticked. */
function useTicks() {
  const [off, setOff] = useState<Set<string>>(new Set());
  return {
    on: (item: string) => !off.has(item),
    toggle: (item: string) =>
      setOff((cur) => {
        const next = new Set(cur);
        if (next.has(item)) next.delete(item);
        else next.add(item);
        return next;
      }),
    kept: (list: string[]) => list.filter((i) => !off.has(i)),
  };
}

/**
 * Step 3, "Is this you?": one snapshot, every section pre-filled from the
 * research and tap-to-fix. Essentials research couldn't fill come first as
 * tap questions. Nothing saves until "Looks good".
 */
export function SnapshotStep({
  proposal,
  onSaved,
}: {
  proposal: OnboardingProposal;
  onSaved: (confirmed: OnboardingProposal) => void;
}) {
  const toast = useToast();
  const [p, setP] = useState<OnboardingProposal>(proposal);
  // Asked once: answering removes a question even when the answer was "you pick".
  const [gaps] = useState(() => gapQuestions(proposal));
  const [answered, setAnswered] = useState<Set<GapId>>(new Set());
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  const products = useTicks();
  const reasons = useTicks();
  const rivals = useTicks();
  const pains = useTicks();
  const words = useTicks();

  const set = (patch: Partial<OnboardingProposal>) => setP((cur) => ({ ...cur, ...patch }));
  const openGaps = gaps.filter((g) => !answered.has(g.id));

  function answer(id: GapId, values: string[]) {
    setP((cur) => answerGap(cur, id, values));
    setAnswered((cur) => new Set(cur).add(id));
  }

  async function save() {
    // An unanswered gap takes its "you pick" default.
    const filled = openGaps.reduce((cur, g) => answerGap(cur, g.id, []), p);
    const confirmed: OnboardingProposal = {
      ...filled,
      products: filled.products.filter((x) => products.on(x.slug)),
      differentiators: reasons.kept(filled.differentiators),
      competitors: rivals.kept(filled.competitors),
      audience: {
        ...filled.audience,
        pains: pains.kept(filled.audience.pains ?? []),
        vocabulary: words.kept(filled.audience.vocabulary ?? []),
      },
    };
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: confirmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save. Try again.");
      onSaved(confirmed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Try again.");
      setSaving(false);
    }
  }

  const line = mainActionLine(p.main_action, p.phone, p.website);
  const guess = (key: string) => p.guesses.includes(key);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {openGaps.map((g) => (
        <GapCard key={g.id} question={g.question} choices={g.choices} multi={g.multi} onAnswer={(v) => answer(g.id, v)} />
      ))}

      <Section title="Your look">
        <div className="space-y-4">
          <LogoPicker url={p.logo_url} name={p.name} onChange={(logo_url) => set({ logo_url })} />
          <div className="flex flex-wrap gap-3">
            {COLOR_ROLES.map(({ key, label }) => (
              <ColorSwatch
                key={key}
                label={label}
                value={p.colors?.[key]}
                onChange={(hex) => set({ colors: { ...p.colors, [key]: hex } })}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Name and what you do">
        <div className="space-y-3">
          <Input value={p.name} onChange={(e) => set({ name: e.target.value })} aria-label="Business name" />
          <Textarea
            rows={2}
            value={p.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="What you do, in a sentence or two"
            aria-label="What you do"
          />
        </div>
      </Section>

      {p.products.length > 0 && (
        <Section title="What you sell" hint="Untick anything that's not yours.">
          <ul className="space-y-2">
            {p.products.map((x) => (
              <li key={x.slug}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox size="sm" className="mt-0.5" checked={products.on(x.slug)} onChange={() => products.toggle(x.slug)} />
                  <span className="min-w-0 text-[14px] leading-snug">
                    <span className="font-medium text-foreground">{x.name}</span>
                    {x.price_point && <span className="text-muted"> · {x.price_point}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <AddRow
            placeholder="Add something you sell"
            onAdd={(name) => {
              const product: ProposedProduct = { slug: slugify(name), name };
              if (product.slug && !p.products.some((x) => x.slug === product.slug)) {
                set({ products: [...p.products, product] });
              }
            }}
          />
        </Section>
      )}

      {(p.audience.label || p.audience.demographics || (p.audience.pains?.length ?? 0) > 0) && (
        <Section title="Who you sell to" guess={guess("audience")}>
          <div className="space-y-3">
            <Input
              value={p.audience.label ?? ""}
              onChange={(e) => set({ audience: { ...p.audience, label: e.target.value } })}
              placeholder="e.g. Homeowners in Dallas"
              aria-label="Your main customer"
            />
            {p.audience.demographics && <p className="text-[13px] text-muted">{p.audience.demographics}</p>}
            <ChipList label="What they need help with" items={p.audience.pains ?? []} ticks={pains} />
            <ChipList label="Words they use" items={p.audience.vocabulary ?? []} ticks={words} />
          </div>
        </Section>
      )}

      <Section title="Why people pick you" hint={p.rating ? `Reviews: ${p.rating}` : "Tap to leave one out."}>
        <ChipList items={p.differentiators} ticks={reasons} />
        <AddRow
          placeholder="Add a reason"
          onAdd={(reason) => {
            if (!p.differentiators.some((d) => d.toLowerCase() === reason.toLowerCase())) {
              set({ differentiators: [...p.differentiators, reason] });
            }
          }}
        />
      </Section>

      <Section title="How customers reach you">
        <div className="flex flex-wrap gap-2">
          {MAIN_ACTION_KINDS.map((kind) => (
            <StepChip
              key={kind}
              label={MAIN_ACTION_LABELS[kind]}
              pressed={p.main_action.kind === kind}
              onClick={() => set({ main_action: { ...p.main_action, kind } })}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="For what" className="sm:col-span-2" hint={line ? `Your calls to action: "${line}"` : undefined}>
            <Input
              value={p.main_action.wording ?? ""}
              onChange={(e) => set({ main_action: { ...p.main_action, wording: e.target.value } })}
              placeholder="e.g. a free estimate"
            />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={p.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} placeholder="(214) 555-0101" />
          </Field>
          <Field label="Website">
            <Input inputMode="url" value={p.website ?? ""} onChange={(e) => set({ website: e.target.value })} placeholder="yourbusiness.com" />
          </Field>
          <Field label="Where you work" className="sm:col-span-2">
            <Input
              value={p.service_area ?? ""}
              onChange={(e) => set({ service_area: e.target.value })}
              placeholder="e.g. Dallas and nearby suburbs"
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="mt-4 text-[13px] font-medium text-accent hover:underline"
        >
          {more ? "Less" : "More: address, guarantee, competitors"}
        </button>
        {more && (
          <div className="mt-3 space-y-3">
            <Field label="Mailing address" hint="Marketing email law requires one in every email footer.">
              <Input value={p.postal_address ?? ""} onChange={(e) => set({ postal_address: e.target.value })} />
            </Field>
            <Field label="Guarantee" hint="A promise you make on every job. Optional.">
              <Input value={p.guarantee ?? ""} onChange={(e) => set({ guarantee: e.target.value })} />
            </Field>
            {p.competitors.length > 0 && <ChipList label="Competitors" items={p.competitors} ticks={rivals} />}
          </div>
        )}
      </Section>

      {p.sources.length > 0 && (
        <p className="px-1 text-[12px] leading-relaxed text-muted-2">
          Found on{" "}
          {p.sources.slice(0, 6).map((s, i) => (
            <span key={s.url}>
              {i > 0 && ", "}
              <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {hostOf(s.url)}
              </a>
            </span>
          ))}
          . Not you? Fix it above.
        </p>
      )}

      <StickyAction hint="You can change any of this later in Settings.">
        <Button variant="gradient" loading={saving} disabled={!p.name.trim()} onClick={save}>
          Looks good
        </Button>
      </StickyAction>
    </motion.div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Section({
  title,
  hint,
  guess,
  children,
}: {
  title: string;
  hint?: string;
  guess?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {guess && <Badge tone="amber">Guess</Badge>}
      </div>
      {hint && <p className="-mt-2 mb-3 text-[12.5px] text-muted">{hint}</p>}
      {children}
    </Card>
  );
}

function ChipList({
  label,
  items,
  ticks,
}: {
  label?: string;
  items: string[];
  ticks: ReturnType<typeof useTicks>;
}) {
  if (!items.length) return null;
  return (
    <div>
      {label && <p className="mb-2 text-[12.5px] font-medium text-muted">{label}</p>}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <StepChip key={item} label={item} pressed={ticks.on(item)} onClick={() => ticks.toggle(item)} />
        ))}
      </div>
    </div>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue("");
  };
  return (
    <div className="mt-3 flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
        className="h-10 text-[14px]"
      />
      <Button variant="subtle" size="sm" onClick={add} disabled={!value.trim()} aria-label={placeholder}>
        <PlusIcon size={15} />
      </Button>
    </div>
  );
}

/** A question research couldn't answer: tap a choice, type it, or "you pick". */
function GapCard({
  question,
  choices,
  multi,
  onAnswer,
}: {
  question: string;
  choices: { label: string; value: string }[];
  multi: boolean;
  onAnswer: (values: string[]) => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <Card className="border-accent/30 p-4 sm:p-5">
      <p className="text-[15px] font-semibold text-foreground">{question}</p>
      {choices.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {choices.map((c) => (
            <StepChip key={c.value} label={c.label} onClick={() => onAnswer([c.value])} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed.trim()) {
              e.preventDefault();
              onAnswer([typed]);
            }
          }}
          placeholder={multi ? "Type them, separated by commas" : "Or type your own"}
          className="h-10 text-[14px]"
        />
        <Button variant="subtle" size="sm" disabled={!typed.trim()} onClick={() => onAnswer([typed])}>
          Add
        </Button>
      </div>
      <button
        type="button"
        onClick={() => onAnswer([])}
        className="mt-3 text-[13px] font-medium text-muted hover:text-foreground"
      >
        Not sure, you pick
      </button>
    </Card>
  );
}

function LogoPicker({
  url,
  name,
  onChange,
}: {
  url?: string;
  name: string;
  onChange: (url: string) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // A logo found on the website is often a small icon, so the owner is asked
  // to confirm it or upload the real file.
  const [uploaded, setUploaded] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/settings/upload-logo", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
      onChange(data.url);
      setUploaded(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const status = uploaded
    ? "Your logo file is in. It goes on every flyer."
    : url
      ? "We found this on your website. If it's blurry or not your full logo, upload your logo file."
      : "Upload your logo file so it shows up right on your flyers.";

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2",
          !url && "border-dashed",
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="max-h-full max-w-full object-contain p-1.5" />
        ) : (
          <span className="px-1 text-center text-[11px] font-medium leading-tight text-muted">No logo</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] text-foreground">{status}</p>
        <p className="text-[12px] text-muted">PNG with a transparent background works best. Max 2MB.</p>
        <Button
          variant={url && !uploaded ? "solid" : "subtle"}
          size="sm"
          loading={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {url ? "Upload a different file" : "Upload your logo"}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1">
      <span
        className="relative h-10 w-10 overflow-hidden rounded-full border border-border-strong"
        style={{ background: value ?? "transparent" }}
      >
        <input
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`${label} color`}
        />
      </span>
      <span className="text-[11px] text-muted">{label}</span>
    </label>
  );
}
