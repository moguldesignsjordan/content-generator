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
import { useRouter } from "next/navigation";
import { Button, Select, useToast } from "@/components/ui";
import {
  BlogIcon,
  MailIcon,
  PlusIcon,
  SendIcon,
  SparkleIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { BlogType, EmailType, FunnelStage } from "@/lib/db/types";

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

  const [card, setCard] = useState<BriefCard | null>(initial?.card ?? null);
  const [topicId, setTopicId] = useState<string | null>(initial?.topicId ?? null);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.campaignId ?? null);
  const [options, setOptions] = useState<Option[] | null>(null);
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading, card, options]);

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

    try {
      const res = await fetch("/api/create/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, history: messages, campaignId }),
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
      setReady(Boolean(data.readyToGenerate));
      // The agent already generated (or reused) a draft this turn; skip the
      // manual Generate fallback and open it directly.
      if (data.draftId) {
        router.push(`/drafts/${data.draftId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Sorry, I hit a snag. Try sending that again." },
      ]);
    } finally {
      clearTimeout(hintTimer);
      setLoading(false);
      setHint(false);
      inputRef.current?.focus();
    }
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

  const empty = messages.length === 0;

  return (
    <div
      className={cn("flex flex-col overflow-hidden", className)}
      style={{ height: "clamp(464px, 64vh, 640px)" }}
    >
      {empty ? (
        // Landing — a clean, centered prompt (headline + input + actions).
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
          <h2 className="max-w-md text-center font-display text-[26px] font-semibold leading-tight text-foreground sm:text-[30px]">
            What are we creating today?
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
            />
            {actionsOpen && (
              <ActionGrid
                onEmail={() => send("Draft an on-brand email")}
                onBlog={() => send("Draft a blog post")}
                onCampaign={() => router.push("/campaigns/new")}
                disabled={loading || generating}
                className="mt-3"
              />
            )}
          </div>
        </div>
      ) : (
        // Conversation — scrolling thread + docked composer.
        <>
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
              <div className="flex justify-start">
                <div className="bubble-in rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3">
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
                onCampaign={() => router.push("/campaigns/new")}
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
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onPlus: () => void;
  ready: boolean;
  disabled: boolean;
}) {
  return (
    <div className="hero-ring flex items-end gap-1.5 rounded-[26px] border border-border bg-surface-2 p-1.5 pl-2 transition-shadow duration-200 focus-within:shadow-[0_0_30px_-12px_rgba(255,61,140,0.5)]">
      <button
        type="button"
        onClick={onPlus}
        aria-label="Quick actions"
        className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
      >
        <PlusIcon size={20} />
      </button>
      <textarea
        ref={inputRef}
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={
          ready ? "Tweak the brief, or hit Generate" : "What do you want to make?"
        }
        className="max-h-32 min-h-[40px] flex-1 self-center resize-none bg-transparent py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:outline-none"
      />
      <Button
        variant="gradient"
        size="md"
        className="h-10 w-10 shrink-0 self-center !px-0"
        onClick={onSend}
        disabled={disabled || !input.trim()}
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
        icon={<MailIcon size={16} />}
        label="Email"
        onClick={onEmail}
        disabled={disabled}
      />
      <ActionButton
        icon={<BlogIcon size={16} />}
        label="Blog post"
        onClick={onBlog}
        disabled={disabled}
      />
      <ActionButton
        icon={<SparkleIcon size={16} />}
        label="Campaign"
        onClick={onCampaign}
        disabled={disabled}
      />
    </div>
  );
}

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
      className="flex items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface-2 px-2.5 py-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:border-accent/40 hover:bg-surface-3 disabled:opacity-50"
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("bubble-in flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed",
          isUser
            ? "rounded-br-sm bg-accent text-white"
            : "rounded-bl-sm bg-surface-2 text-foreground",
        )}
      >
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
    <div className="bubble-in rounded-[var(--radius-lg)] border border-border bg-surface-2 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        <SparkleIcon size={12} className="text-accent" />
        Brief
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
            <SparkleIcon size={14} />
            {generating
              ? "Generating…"
              : channel === "blog"
                ? "Generate blog post"
                : "Generate email"}
          </Button>
        </div>
      )}
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

function Typing({ hint }: { hint: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      {hint && (
        <span className="text-[11px] text-muted-2">
          drafting can take a minute…
        </span>
      )}
    </div>
  );
}
