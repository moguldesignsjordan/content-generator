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
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  ChevronRightIcon,
  FlyerIcon,
  MailIcon,
  MegaphoneIcon,
  type IconProps,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { toastApiError } from "@/lib/billing/toast-error";

// The form-based campaign start: every question the old chat interview asked,
// as on-page selections. One submit saves the brief (/api/campaigns/start),
// then kicks off the email (/api/generate) and/or the social flyer
// (/api/flyers/generate) the same way the chat's handoff did.

type Channel = "email" | "social" | "both";

const CHANNELS: Array<{
  value: Channel;
  label: string;
  desc: string;
  icon: (p: IconProps) => React.ReactNode;
}> = [
  {
    value: "email",
    label: "Email",
    desc: "A designed email for your list",
    icon: MailIcon,
  },
  {
    value: "social",
    label: "Social post",
    desc: "A flyer for Facebook or Instagram",
    icon: FlyerIcon,
  },
  {
    value: "both",
    label: "Both",
    desc: "The email plus a matching post",
    icon: MegaphoneIcon,
  },
];

const GOALS = [
  { id: "book", goal: "Book more calls", funnel: "decision" },
  { id: "sales", goal: "Drive sales", funnel: "decision" },
  { id: "signups", goal: "Get signups", funnel: "consideration" },
  { id: "announce", goal: "Announce something new", funnel: "awareness" },
];

const TONES = [
  { id: "", label: "My usual voice", tone: undefined },
  { id: "playful", label: "More playful", tone: "more playful than usual" },
  { id: "urgent", label: "More urgent", tone: "more urgent and time-sensitive" },
  {
    id: "professional",
    label: "More professional",
    tone: "more professional and polished",
  },
  { id: "bold", label: "Bolder", tone: "bolder and more direct" },
];

const VIBES = [
  { id: "", label: "Surprise me" },
  { id: "punchy", label: "Punchy and bold" },
  { id: "sleek", label: "Sleek and minimal" },
  { id: "playful", label: "Playful and fun" },
  { id: "premium", label: "Premium and polished" },
];

const LENGTHS = [
  { id: "", label: "My usual" },
  { id: "short", label: "Short and punchy" },
  { id: "standard", label: "Standard" },
  { id: "long", label: "Long and detailed" },
];

// Mirrors FLYER_ASPECTS in prompts/generate-flyer.ts (server prompt layer,
// not importable from a client component).
const ASPECTS = [
  { value: "1:1", label: "Square 1:1" },
  { value: "4:5", label: "Portrait 4:5" },
  { value: "9:16", label: "Story 9:16" },
];

export interface CampaignProductOption {
  slug: string;
  name: string;
}

export interface CampaignTopicChoice {
  id: string;
  title: string;
  pillar: string;
}

export function CampaignForm({
  products,
  topics,
}: {
  products: CampaignProductOption[];
  topics: CampaignTopicChoice[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [channel, setChannel] = useState<Channel>("email");
  const [goalId, setGoalId] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [offerSlug, setOfferSlug] = useState("");
  const [toneId, setToneId] = useState("");
  const [customTone, setCustomTone] = useState("");
  const [vibeId, setVibeId] = useState("");
  const [lengthId, setLengthId] = useState("");
  const [imageChoice, setImageChoice] = useState("default");
  const [aspect, setAspect] = useState("1:1");
  const [moreOpen, setMoreOpen] = useState(false);
  const [audience, setAudience] = useState("");
  const [angle, setAngle] = useState("");
  const [constraints, setConstraints] = useState("");
  const [topicId, setTopicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  const wantsEmail = channel !== "social";
  const wantsSocial = channel !== "email";

  const goalText =
    goalId === "custom"
      ? customGoal.trim()
      : (GOALS.find((g) => g.id === goalId)?.goal ?? "");
  const canSubmit = Boolean(goalText && keyMessage.trim()) && !busy;

  async function launch() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      setPhase("Saving your campaign…");
      const tone =
        toneId === "custom"
          ? customTone.trim() || undefined
          : TONES.find((t) => t.id === toneId)?.tone;
      const startRes = await fetch("/api/campaigns/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goalText,
          key_message: keyMessage.trim(),
          audience_notes: audience.trim() || undefined,
          offer_slug: offerSlug || undefined,
          angle: angle.trim() || undefined,
          constraints: constraints.trim() || undefined,
          tone,
          length: lengthId || undefined,
          include_image:
            !wantsEmail || imageChoice === "default"
              ? undefined
              : imageChoice === "yes",
          visual_vibe: vibeId || undefined,
          topic_id: topicId || undefined,
          funnel_stage: GOALS.find((g) => g.id === goalId)?.funnel,
        }),
      });
      const startData = (await startRes.json()) as {
        campaignId?: string;
        topicId?: string;
        error?: string;
      };
      if (!startRes.ok || !startData.topicId) {
        toastApiError(toast, startData, "Couldn't start the campaign.");
        return;
      }
      const { campaignId, topicId: resolvedTopicId } = startData;

      let flyerDraftId: string | undefined;
      let flyerError: { error?: string } | null = null;
      if (wantsSocial) {
        setPhase("Queueing your social post…");
        const res = await fetch("/api/flyers/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicId: resolvedTopicId,
            campaignId,
            aspect,
            brief: buildFlyerBrief(),
          }),
        });
        const data = (await res.json()) as { draftId?: string; error?: string };
        if (res.ok && data.draftId) flyerDraftId = data.draftId;
        else flyerError = data;
      }

      let emailDraftId: string | undefined;
      let emailError: { error?: string } | null = null;
      if (wantsEmail) {
        setPhase("Starting your email…");
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId: resolvedTopicId, campaignId }),
        });
        const data = (await res.json()) as { draftId?: string; error?: string };
        if (res.ok && data.draftId) emailDraftId = data.draftId;
        else emailError = data;
      }

      if (emailDraftId) {
        if (flyerDraftId) {
          toast.success("Your social post is queued too. Open it from Flyers.");
        } else if (flyerError) {
          toastApiError(toast, flyerError, "Couldn't start the social post.");
        }
        router.push(`/drafts/${emailDraftId}`);
        return;
      }
      if (flyerDraftId) {
        if (emailError) {
          toastApiError(toast, emailError, "Couldn't start the email.");
        }
        router.push(`/drafts/${flyerDraftId}`);
        return;
      }
      if (emailError) toastApiError(toast, emailError, "Couldn't start the email.");
      else if (flyerError) {
        toastApiError(toast, flyerError, "Couldn't start the social post.");
      }
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  function buildFlyerBrief(): string {
    return [
      keyMessage.trim(),
      goalText && `Goal: ${goalText}`,
      angle.trim() && `Angle: ${angle.trim()}`,
      audience.trim() && `Audience: ${audience.trim()}`,
      constraints.trim() && `Notes: ${constraints.trim()}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-6">
        {/* What are we making? */}
        <Section label="What are we making?">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CHANNELS.map((c) => {
              const active = channel === c.value;
              const Icon = c.icon;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => setChannel(c.value)}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-lg)] border p-3.5 text-left transition-colors disabled:opacity-50 sm:flex-col sm:items-start sm:gap-2 sm:p-4",
                    active
                      ? "border-accent bg-accent/[0.07] ring-1 ring-accent"
                      : "border-border hover:border-accent/50",
                  )}
                >
                  <Icon
                    size={20}
                    className={cn("shrink-0", active ? "text-accent" : "text-muted")}
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-foreground">
                      {c.label}
                    </span>
                    <span className="block text-[12.5px] leading-snug text-muted">
                      {c.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Goal */}
        <Section label="What should it make happen?">
          <ChipRow>
            {GOALS.map((g) => (
              <Chip
                key={g.id}
                active={goalId === g.id}
                disabled={busy}
                onClick={() => setGoalId(g.id)}
              >
                {g.goal}
              </Chip>
            ))}
            <Chip
              active={goalId === "custom"}
              disabled={busy}
              onClick={() => setGoalId("custom")}
            >
              Something else
            </Chip>
          </ChipRow>
          {goalId === "custom" && (
            <Input
              className="mt-2"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="e.g. Fill the Saturday workshop"
              disabled={busy}
              maxLength={140}
            />
          )}
        </Section>

        {/* Key message */}
        <Field
          label="What's the one thing it should say?"
          hint="The takeaway you want people to remember. A sentence or two is plenty."
        >
          <Textarea
            value={keyMessage}
            onChange={(e) => setKeyMessage(e.target.value)}
            placeholder="e.g. Our new client portal is live, and it makes working with us twice as fast"
            rows={3}
            disabled={busy}
          />
        </Field>

        {/* Product */}
        {products.length > 0 && (
          <Section label="Is this about one of your products?">
            <ChipRow>
              <Chip
                active={offerSlug === ""}
                disabled={busy}
                onClick={() => setOfferSlug("")}
              >
                Nothing specific
              </Chip>
              {products.map((p) => (
                <Chip
                  key={p.slug}
                  active={offerSlug === p.slug}
                  disabled={busy}
                  onClick={() => setOfferSlug(p.slug)}
                >
                  {p.name}
                </Chip>
              ))}
            </ChipRow>
          </Section>
        )}

        {/* Tone */}
        <Section label="How should the words sound?">
          <ChipRow>
            {TONES.map((t) => (
              <Chip
                key={t.id}
                active={toneId === t.id}
                disabled={busy}
                onClick={() => setToneId(t.id)}
              >
                {t.label}
              </Chip>
            ))}
            <Chip
              active={toneId === "custom"}
              disabled={busy}
              onClick={() => setToneId("custom")}
            >
              Something else
            </Chip>
          </ChipRow>
          {toneId === "custom" && (
            <Input
              className="mt-2"
              value={customTone}
              onChange={(e) => setCustomTone(e.target.value)}
              placeholder="e.g. warm but no-nonsense"
              disabled={busy}
              maxLength={140}
            />
          )}
        </Section>

        {/* Vibe */}
        <Section label="What's the look and feel?">
          <ChipRow>
            {VIBES.map((v) => (
              <Chip
                key={v.id}
                active={vibeId === v.id}
                disabled={busy}
                onClick={() => setVibeId(v.id)}
              >
                {v.label}
              </Chip>
            ))}
          </ChipRow>
        </Section>

        {/* Email options */}
        {wantsEmail && (
          <Section label="How long should the email be?">
            <ChipRow>
              {LENGTHS.map((l) => (
                <Chip
                  key={l.id}
                  active={lengthId === l.id}
                  disabled={busy}
                  onClick={() => setLengthId(l.id)}
                >
                  {l.label}
                </Chip>
              ))}
            </ChipRow>
            <div className="mt-4">
              <Field label="Want a picture in it?">
                <SegmentedControl
                  value={imageChoice}
                  onChange={setImageChoice}
                  options={[
                    { value: "default", label: "Brand default" },
                    { value: "yes", label: "Add a picture" },
                    { value: "no", label: "No picture" },
                  ]}
                />
              </Field>
            </div>
          </Section>
        )}

        {/* Social options */}
        {wantsSocial && (
          <Field label="Post shape">
            <SegmentedControl value={aspect} onChange={setAspect} options={ASPECTS} />
          </Field>
        )}

        {/* More details */}
        <div>
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
          >
            <ChevronRightIcon
              size={15}
              className={cn("transition-transform", moreOpen && "rotate-90")}
            />
            More details (optional)
          </button>
          {moreOpen && (
            <div className="mt-4 flex flex-col gap-4">
              <Field label="Who is it for?">
                <Input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="e.g. past clients who haven't booked in a while"
                  disabled={busy}
                  maxLength={200}
                />
              </Field>
              <Field label="Got an angle or hook in mind?">
                <Input
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  placeholder="e.g. behind the scenes of the redesign"
                  disabled={busy}
                  maxLength={200}
                />
              </Field>
              <Field label="Anything to avoid or must-include?">
                <Textarea
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder="e.g. mention the July deadline, don't use the word cheap"
                  rows={2}
                  disabled={busy}
                />
              </Field>
              {topics.length > 0 && (
                <Field
                  label="Tie it to a planned topic"
                  hint="Leave this alone and we'll start a fresh one from your answers."
                >
                  <Select
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Start a fresh one</option>
                    {groupByPillar(topics).map(([pillar, ts]) => (
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
              )}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button
            variant="gradient"
            size="md"
            onClick={launch}
            disabled={!canSubmit}
            loading={busy}
          >
            {wantsEmail && wantsSocial
              ? "Create email + post"
              : wantsSocial
                ? "Create social post"
                : "Create email"}
          </Button>
          {busy && phase ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={14} /> {phase}
            </p>
          ) : (
            !canSubmit &&
            !busy && (
              <p className="text-[13px] text-muted">
                Pick a goal and add the one thing it should say.
              </p>
            )
          )}
        </div>
      </div>
    </Card>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-foreground/90">{label}</p>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
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
  topics: CampaignTopicChoice[],
): [string, CampaignTopicChoice[]][] {
  const map = new Map<string, CampaignTopicChoice[]>();
  for (const t of topics) {
    const arr = map.get(t.pillar) ?? [];
    arr.push(t);
    map.set(t.pillar, arr);
  }
  return Array.from(map.entries());
}
