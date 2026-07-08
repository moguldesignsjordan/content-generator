"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Logo, Select, useToast } from "@/components/ui";
import {
  BlogIcon,
  MailIcon,
  MegaphoneIcon,
  PlusIcon,
  SendIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useGenerationStream } from "@/lib/use-generation-stream";
import type { BlogType, EmailType, FunnelStage, SeriesDraftRef } from "@/lib/db/types";

// Labels for the manual email_type/blog_type override (migration 005). Left
// unset, generation derives the type from the topic as before; picking one
// here overrides that derivation for this job.
const EMAIL_TYPE_OPTIONS: { value: EmailType; label: string }[] = [
  { value: "newsletter", label: "Newsletter" },
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "promotional", label: "Promotional" },
  { value: "announcement", label: "Announcement" },
];

const BLOG_TYPE_OPTIONS: { value: BlogType; label: string }[] = [
  { value: "pillar", label: "Pillar" },
  { value: "how_to", label: "How-to" },
  { value: "listicle", label: "Listicle" },
  { value: "case_study", label: "Case study" },
  { value: "thought_leadership", label: "Thought leadership" },
  { value: "landing", label: "Landing" },
];

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/* Concrete things you can type, cycled through the empty composer so the
   landing teaches by example instead of a static "type here". */
const PROMPT_IDEAS = [
  "What do you want to make?",
  "Draft a win-back email for past clients",
  "Write a blog post about our latest build",
  "Announce a new service to the list",
  "Turn our best email into a blog post",
  "Plan a launch campaign for this month",
];

export interface CreateAgentSuggestion {
  label: string;
  text: string;
}

/** The brief as resolved by the route, rendered as editable rows. */
interface BriefCard {
  topicTitle: string | null;
  audience: string | null;
  goal: string | null;
  keyMessage: string | null;
  angle: string | null;
  offerName: string | null;
  offerPrice: string | null;
  funnelStage: FunnelStage | null;
  ctaLabel: string | null;
}

interface Option {
  id: string;
  label: string;
  kind: "topic" | "action";
}

interface CreateResponse {
  reply?: string;
  campaignId?: string;
  topicId?: string | null;
  card?: BriefCard | null;
  options?: Option[] | null;
  readyToGenerate?: boolean;
  draftId?: string | null;
  series?: SeriesDraftRef[] | null;
  error?: string;
}

/** Resumed state from the brand's most recent in-flight campaign, so a page
 * reload picks the thread back up instead of starting blank. */
export interface CreateAgentInitialState {
  campaignId: string;
  messages: Msg[];
  card: BriefCard | null;
  topicId: string | null;
  ready: boolean;
  series: SeriesDraftRef[] | null;
}

/**
 * The dashboard creation agent: a brief-then-generate chat that turns "what
 * are we creating today?" into an editable email brief and drives it all the
 * way to a generated draft. Posts to /api/create/chat; when the agent calls
 * generate_content, the response carries a draftId and this component
 * navigates to the draft review page automatically. The brief card + manual
 * Generate button remain as a fallback for turns where the agent asked a
 * clarifying question instead.
 */
export function CreateAgent({
  className,
  initial,
}: {
  className?: string;
  initial?: CreateAgentInitialState;
}) {
  const router = useRouter();
  const toast = useToast();

  const [messages, setMessages] = useState<Msg[]>(initial?.messages ?? []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [card, setCard] = useState<BriefCard | null>(initial?.card ?? null);
  const [topicId, setTopicId] = useState<string | null>(initial?.topicId ?? null);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.campaignId ?? null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [series, setSeries] = useState<SeriesDraftRef[] | null>(initial?.series ?? null);
  const [ready, setReady] = useState(initial?.ready ?? false);
  const [generating, setGenerating] = useState(false);
  // Quick-action panel open state. Open in the landing; tapping + toggles it.
  // Closes on send so the conversation reads clean.
  const [actionsOpen, setActionsOpen] = useState(true);
  // Which pipeline the brief hands off to. Same brief, different renderer:
  // email → the email draft pipeline, blog → the Sanity-bound blog pipeline.
  const [channel, setChannel] = useState<"email" | "blog">("email");
  // Manual subtype override, sent to /api/generate as-is when set. Left on
  // "" (Auto), generation derives the type from the topic as before.
  const [emailType, setEmailType] = useState<EmailType | "">("");
  const [blogType, setBlogType] = useState<BlogType | "">("");

  // Which example prompt the empty composer is showing (landing only).
  const [phIndex, setPhIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const empty = messages.length === 0;

  // Cycle the landing placeholder through concrete prompt ideas. Skipped
  // entirely for reduced-motion users, who keep the first (generic) prompt.
  useEffect(() => {
    if (!empty) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setPhIndex((i) => (i + 1) % PROMPT_IDEAS.length),
      3600,
    );
    return () => clearInterval(id);
  }, [empty]);

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading, card, options, series]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || loading || generating) return;
    setInput("");
    setError(null);
    setHint(false);
    setOptions(null);
    setActionsOpen(false);
    setMessages((m) => [...m, { role: "user", content: t }]);
    setLoading(true);
    const hintTimer = setTimeout(() => setHint(true), 6000);
    const controller = new AbortController();
    // This route can chain several tool round-trips server-side (up to
    // maxDuration = 300s); abort a good margin before that so a hung request
    // surfaces as an error instead of spinning the typing indicator forever.
    const timeoutTimer = setTimeout(() => controller.abort(), 280_000);

    try {
      const res = await fetch("/api/create/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, history: messages, campaignId }),
        signal: controller.signal,
      });
      const data = (await res.json()) as CreateResponse;
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "Something went wrong.");
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply! }]);
      if (data.campaignId) setCampaignId(data.campaignId);
      setTopicId(data.topicId ?? null);
      setCard(data.card ?? null);
      setOptions(data.options ?? null);
      if (data.series?.length) setSeries(data.series);
      setReady(Boolean(data.readyToGenerate));
      // The agent already generated (or reused) a draft this turn; skip the
      // manual Generate fallback and open it directly.
      if (data.draftId) {
        router.push(`/drafts/${data.draftId}`);
      }
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      setError(
        timedOut
          ? "That took too long. Try sending it again."
          : err instanceof Error
            ? err.message
            : "Something went wrong.",
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: timedOut
            ? "Sorry, that took too long. Try sending that again."
            : "Sorry, I hit a snag. Try sending that again.",
        },
      ]);
    } finally {
      clearTimeout(hintTimer);
      clearTimeout(timeoutTimer);
      setLoading(false);
      setHint(false);
      inputRef.current?.focus();
    }
  }

  function clearChat() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    if (campaignId) {
      fetch(`/api/campaigns/${campaignId}/clear`, { method: "POST" }).catch(() => {});
    }
    setMessages([]);
    setInput("");
    setCard(null);
    setTopicId(null);
    setCampaignId(null);
    setOptions(null);
    setSeries(null);
    setReady(false);
    setGenerating(false);
    setError(null);
    setActionsOpen(true);
  }

  async function generate() {
    if (!topicId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          campaignId,
          channel,
          emailType: emailType || undefined,
          blogType: blogType || undefined,
        }),
      });
      const data = (await res.json()) as { draftId?: string; error?: string };
      if (!res.ok || !data.draftId) {
        throw new Error(data.error ?? "Generation failed.");
      }
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
      setGenerating(false);
    }
  }

  return (
    <div
      className={cn("flex flex-col overflow-hidden", className)}
      style={{ height: "clamp(480px, calc(100dvh - 200px), 800px)" }}
    >
      {empty ? (
        // Landing — a centered prompt: beacon, headline, input, actions.
        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-4 py-10">
          <h2 className="max-w-md text-center font-display text-[26px] font-semibold leading-tight text-foreground [text-wrap:balance] sm:text-[30px]">
            What are we{" "}
            <span className="relative inline-block">
              creating
              <span
                aria-hidden
                className="bar-spectrum bar-live absolute -bottom-1 left-0 h-[3px] w-full rounded-full"
              />
            </span>{" "}
            today?
          </h2>
          <div className="w-full max-w-xl">
            <ComposerBar
              inputRef={inputRef}
              input={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              onSend={() => send(input)}
              onPlus={() => setActionsOpen((v) => !v)}
              ready={ready}
              disabled={loading || generating}
              placeholderCycle={PROMPT_IDEAS[phIndex]}
            />
            {actionsOpen && (
              <ActionGrid
                onEmail={() => send("Draft an on-brand email")}
                onBlog={() => send("Draft a blog post")}
                onCampaign={() =>
                  send("I want to plan a campaign: a series of emails")
                }
                disabled={loading || generating}
                className="mt-3"
              />
            )}
          </div>
        </div>
      ) : (
        // Conversation — scrolling thread + docked composer.
        <>
          <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
            <button
              type="button"
              onClick={clearChat}
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {confirmClear ? "Confirm clear?" : "Clear chat"}
            </button>
          </div>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 momentum"
          >
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}

            {card && (
              <BriefCardView
                card={card}
                disabled={loading || generating}
                ready={ready && Boolean(topicId)}
                generating={generating}
                channel={channel}
                onChannelChange={setChannel}
                emailType={emailType}
                onEmailTypeChange={setEmailType}
                blogType={blogType}
                onBlogTypeChange={setBlogType}
                onEditRow={(label, value) =>
                  send(`Change the ${label.toLowerCase()}: ${value}`)
                }
                onGenerate={generate}
              />
            )}

            {series && series.length > 0 && <SeriesCardView items={series} />}

            {options && options.length > 0 && !loading && (
              <div className="bubble-in flex flex-wrap gap-2">
                {options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => send(opt.label)}
                    disabled={loading || generating}
                    className="rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="bubble-in flex items-end gap-2">
                <AgentDot className="mb-0.5" />
                <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3">
                  <Typing hint={hint} />
                </div>
              </div>
            )}
          </div>

          {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

          {actionsOpen && (
            <div className="px-3">
              <ActionGrid
                onEmail={() => send("Draft an on-brand email")}
                onBlog={() => send("Draft a blog post")}
                onCampaign={() =>
                  send("I want to plan a campaign: a series of emails")
                }
                disabled={loading || generating}
              />
            </div>
          )}

          <div className="p-3 pt-2">
            <ComposerBar
              inputRef={inputRef}
              input={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              onSend={() => send(input)}
              onPlus={() => setActionsOpen((v) => !v)}
              ready={ready}
              disabled={loading || generating}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ComposerBar({
  inputRef,
  input,
  onChange,
  onKeyDown,
  onSend,
  onPlus,
  ready,
  disabled,
  placeholderCycle,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onPlus: () => void;
  ready: boolean;
  disabled: boolean;
  /** When set (landing), the placeholder cycles through example prompts as a
   * faded-in overlay; the native placeholder is suppressed in its favor. */
  placeholderCycle?: string;
}) {
  const cycling = placeholderCycle !== undefined && !ready;
  const hasText = Boolean(input.trim());
  return (
    <div className="hero-ring composer-glow flex items-end gap-1.5 rounded-[28px] border border-border bg-surface-2 p-2 pl-2.5">
      <button
        type="button"
        onClick={onPlus}
        aria-label="Quick actions"
        className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
      >
        <PlusIcon size={20} />
      </button>
      <div className="relative min-w-0 flex-1 self-center">
        <textarea
          ref={inputRef}
          value={input}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Message the create agent"
          placeholder={
            cycling
              ? undefined
              : ready
                ? "Tweak the brief, or hit Generate"
                : "What do you want to make?"
          }
          className="max-h-32 min-h-[40px] w-full resize-none bg-transparent py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:outline-none"
        />
        {cycling && !input && (
          <span
            key={placeholderCycle}
            aria-hidden
            className="ph-cycle pointer-events-none absolute inset-x-0 top-2 truncate text-[15px] leading-relaxed text-muted"
          >
            {placeholderCycle}
          </span>
        )}
      </div>
      <Button
        variant="gradient"
        size="md"
        className={cn(
          "h-10 w-10 shrink-0 self-center !px-0",
          hasText && "send-pop",
        )}
        onClick={onSend}
        disabled={disabled || !hasText}
        aria-label="Send message"
      >
        <SendIcon size={18} />
      </Button>
    </div>
  );
}

function ActionGrid({
  onEmail,
  onBlog,
  onCampaign,
  disabled,
  className,
}: {
  onEmail: () => void;
  onBlog: () => void;
  onCampaign: () => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      <ActionButton
        icon={<MailIcon size={15} />}
        label="Email"
        onClick={onEmail}
        disabled={disabled}
      />
      <ActionButton
        icon={<BlogIcon size={15} />}
        label="Blog post"
        onClick={onBlog}
        disabled={disabled}
      />
      <ActionButton
        icon={<MegaphoneIcon size={15} />}
        label="Campaign"
        onClick={onCampaign}
        disabled={disabled}
      />
    </div>
  );
}

/* Quiet, uniform tiles: muted icon that wakes to foreground on hover. The
   color in this view belongs to the chat bar, not the shortcuts. */
function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface-2 px-2.5 py-2.5 text-[12.5px] font-medium text-foreground transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:bg-surface-3 disabled:opacity-50"
    >
      <span className="shrink-0 text-muted transition-colors duration-150 group-hover:text-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/* The agent's identity dot: the Mogul mark inside a static spectrum ring.
   Marks assistant turns (and the thinking state) without a heavy avatar. */
function AgentDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ring-spectrum flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
    >
      <Logo height={15} alt="" className="!rounded-none" />
    </span>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="bubble-in flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="bubble-in flex items-end gap-2">
      <AgentDot className="mb-0.5" />
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground">
        {msg.content}
      </div>
    </div>
  );
}

interface BriefRow {
  label: string;
  value: string | null;
  hint?: string;
}

/**
 * The editable brief card. Each row is tap-to-edit; committing a row sends a
 * short instruction back through the agent so it applies the change as a brief
 * update. When ready, a Generate action hands off to the draft pipeline.
 */
function BriefCardView({
  card,
  disabled,
  ready,
  generating,
  channel,
  onChannelChange,
  emailType,
  onEmailTypeChange,
  blogType,
  onBlogTypeChange,
  onEditRow,
  onGenerate,
}: {
  card: BriefCard;
  disabled: boolean;
  ready: boolean;
  generating: boolean;
  channel: "email" | "blog";
  onChannelChange: (c: "email" | "blog") => void;
  emailType: EmailType | "";
  onEmailTypeChange: (t: EmailType | "") => void;
  blogType: BlogType | "";
  onBlogTypeChange: (t: BlogType | "") => void;
  onEditRow: (label: string, value: string) => void;
  onGenerate: () => void;
}) {
  const rows: BriefRow[] = [
    { label: "Topic", value: card.topicTitle },
    { label: "For", value: card.audience },
    {
      label: "Goal",
      value: card.goal,
      hint: card.funnelStage
        ? `${card.funnelStage}${card.ctaLabel ? ` · ${card.ctaLabel}` : ""}`
        : undefined,
    },
    {
      label: "Offer",
      value: card.offerName,
      hint: card.offerPrice ?? undefined,
    },
  ];

  return (
    <div
      className={cn(
        "bubble-in rounded-[var(--radius-lg)] border bg-surface-2 p-3 transition-shadow duration-300",
        // Ready is the payoff moment: the brief wears the spectrum hairline
        // and a soft halo, signaling "this is what gets generated".
        ready ? "ring-spectrum glow-spectrum-soft border-transparent" : "border-border",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          <span className="bar-spectrum h-1 w-4 rounded-full" />
          Brief
        </span>
        {ready && !generating && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Ready
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {rows.map((row) => (
          <EditableRow
            key={row.label}
            label={row.label}
            value={row.value}
            hint={row.hint}
            disabled={disabled}
            onCommit={(value) => onEditRow(row.label, value)}
          />
        ))}
      </div>

      {card.keyMessage && (
        <p className="mt-2 rounded-[var(--radius-md)] bg-surface-3 px-3 py-2 text-[13px] italic text-muted">
          &ldquo;{card.keyMessage}&rdquo;
        </p>
      )}

      {ready && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
              {(["email", "blog"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChannelChange(c)}
                  disabled={disabled}
                  className={cn(
                    "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                    channel === c
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {c === "email" ? "Email" : "Blog post"}
                </button>
              ))}
            </div>
            <div className="w-[150px] shrink-0">
              {channel === "email" ? (
                <Select
                  value={emailType}
                  onChange={(e) => onEmailTypeChange(e.target.value as EmailType | "")}
                  disabled={disabled}
                  className="h-8 !px-2.5 text-[12px]"
                  aria-label="Email type override"
                >
                  <option value="">Auto type</option>
                  {EMAIL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  value={blogType}
                  onChange={(e) => onBlogTypeChange(e.target.value as BlogType | "")}
                  disabled={disabled}
                  className="h-8 !px-2.5 text-[12px]"
                  aria-label="Blog type override"
                >
                  <option value="">Auto format</option>
                  {BLOG_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          <Button
            variant="gradient"
            size="sm"
            onClick={onGenerate}
            loading={generating}
            disabled={disabled}
          >
            {generating
              ? "Generating…"
              : channel === "blog"
                ? "Generate blog post"
                : "Generate email"}
          </Button>
        </div>
      )}

      {/* Honest progress: a spectrum sweep while the draft is being written. */}
      {generating && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-surface-3">
          <div
            className="bg-spectrum h-full w-1/3 rounded-full"
            style={{ animation: "progress-indeterminate 1.3s ease-in-out infinite" }}
          />
        </div>
      )}
    </div>
  );
}


/** How many series emails generate at once; keeps a 10-email series from
 * firing 10 concurrent Claude calls at once. */
const SERIES_CONCURRENCY = 3;

/**
 * The deliverable card for a multi-email campaign: one row per created draft.
 * All emails start writing themselves as soon as the card appears (a few at a
 * time, via the same SSE stream the draft review page uses), so the whole
 * series is ready to review without opening each draft first.
 */
function SeriesCardView({ items }: { items: SeriesDraftRef[] }) {
  const ids = items.map((item) => item.draft_id);
  const [settled, setSettled] = useState<Record<string, "ready" | "error">>({});

  // The first SERIES_CONCURRENCY not-yet-settled drafts are "active" (mounted,
  // streaming); the rest wait their turn. A settled slot frees up immediately
  // since it drops out of this filter on the next render.
  const active = new Set<string>();
  for (const id of ids) {
    if (active.size >= SERIES_CONCURRENCY) break;
    if (!settled[id]) active.add(id);
  }

  return (
    <div className="bubble-in rounded-[var(--radius-lg)] border border-border bg-surface-2 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          <span className="bar-spectrum h-1 w-4 rounded-full" />
          Campaign series
        </span>
        <span className="text-[11px] font-medium text-muted">
          {items.length} emails
        </span>
      </div>
      <div className="divide-y divide-border">
        {items.map((item, i) => (
          <SeriesRow
            key={item.draft_id}
            index={i}
            item={item}
            active={active.has(item.draft_id)}
            settledStatus={settled[item.draft_id]}
            onSettle={(status) =>
              setSettled((s) => ({ ...s, [item.draft_id]: status }))
            }
          />
        ))}
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted-2">
        All emails are writing themselves now. Open any one to review, approve,
        and schedule it.
      </p>
    </div>
  );
}

function SeriesRow({
  index,
  item,
  active,
  settledStatus,
  onSettle,
}: {
  index: number;
  item: SeriesDraftRef;
  active: boolean;
  settledStatus: "ready" | "error" | undefined;
  onSettle: (status: "ready" | "error") => void;
}) {
  const typeChip = item.email_type && (
    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] capitalize text-muted">
      {item.email_type}
    </span>
  );

  if (!active && !settledStatus) {
    // Not this row's turn yet: static, no connection opened.
    return (
      <div className="flex items-center gap-3 px-1 py-2.5 text-[13.5px] opacity-70">
        <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
        {typeChip}
        <span className="shrink-0 text-[11.5px] text-muted-2">Queued</span>
      </div>
    );
  }

  return (
    <SeriesRowStreaming
      index={index}
      item={item}
      settledStatus={settledStatus}
      onSettle={onSettle}
      typeChip={typeChip}
    />
  );
}

/** Split out so useGenerationStream only mounts (and opens a connection) once
 * a row goes active, and unmounts are cheap once it settles. */
function SeriesRowStreaming({
  index,
  item,
  settledStatus,
  onSettle,
  typeChip,
}: {
  index: number;
  item: SeriesDraftRef;
  settledStatus: "ready" | "error" | undefined;
  onSettle: (status: "ready" | "error") => void;
  typeChip: ReactNode;
}) {
  const stream = useGenerationStream(item.draft_id);
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    if (stream.status === "ready" || stream.status === "error") {
      notified.current = true;
      onSettle(stream.status);
    }
  }, [stream.status, onSettle]);

  const status = settledStatus ?? stream.status;
  const isReady = status === "ready";
  const isError = status === "error";

  if (isReady || isError) {
    return (
      <Link
        href={`/drafts/${item.draft_id}`}
        className="group flex items-center gap-3 px-1 py-2.5 text-[13.5px]"
      >
        <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent">
          {item.title}
        </span>
        {typeChip}
        {isError ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              notified.current = false;
              stream.retry();
            }}
            className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[11.5px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
          >
            Retry
          </button>
        ) : (
          <span className="shrink-0 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
            Open
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 px-1 py-2.5 text-[13.5px]">
      <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
      {typeChip}
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-2">
        <AccentSpinner size={12} />
        {stream.label}
      </span>
    </div>
  );
}

function EditableRow({
  label,
  value,
  hint,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null;
  hint?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== (value ?? "")) onCommit(next);
  }

  return (
    <div className="flex items-center gap-3 px-1 py-2 text-[13.5px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              "truncate",
              value ? "text-foreground" : "text-muted-2 italic",
            )}
          >
            {value || `add ${label.toLowerCase()}`}
          </span>
          {hint && <span className="shrink-0 text-[12px] text-muted-2">{hint}</span>}
        </button>
      )}
    </div>
  );
}

/* Thinking state in brand color: the three spectral dots pulse in sequence,
   amber into magenta into cyan. Reduced motion collapses to steady dots. */
function Typing({ hint }: { hint: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex gap-1">
        {(["bg-amber", "bg-magenta", "bg-cyan"] as const).map((tone, i) => (
          <span
            key={tone}
            className={cn("dot-spectrum h-1.5 w-1.5 rounded-full", tone)}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
      <span className="text-[11px] text-muted-2">
        {hint ? "drafting can take a minute…" : "thinking"}
      </span>
    </div>
  );
}
