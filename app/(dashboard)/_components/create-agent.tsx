"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { SendIcon, SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { FunnelStage } from "@/lib/db/types";

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
  error?: string;
}

/**
 * The dashboard creation agent: a brief-then-confirm chat that turns "what are
 * we creating today?" into an editable email brief, then hands off to the
 * existing draft pipeline. Posts to /api/create/chat; on confirm it POSTs
 * /api/generate and opens the draft review page.
 */
export function CreateAgent({
  suggestions = [],
  className,
}: {
  suggestions?: CreateAgentSuggestion[];
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [card, setCard] = useState<BriefCard | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [ready, setReady] = useState(false);
  const [generating, setGenerating] = useState(false);

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
        body: JSON.stringify({ topicId, campaignId }),
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
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface",
        className,
      )}
      style={{ height: "clamp(440px, 60vh, 600px)" }}
    >
      {/* Thread */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 momentum"
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2">
              <SparkleIcon className="text-accent" />
            </span>
            <p className="text-[15px] font-medium text-foreground">
              What are we creating today?
            </p>
            <p className="mt-1 text-[13px] text-muted">
              Describe the email you want and I&rsquo;ll draft a brief you can confirm.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}

            {card && (
              <BriefCardView
                card={card}
                disabled={loading || generating}
                ready={ready && Boolean(topicId)}
                generating={generating}
                onEditRow={(label, value) =>
                  send(`Change the ${label.toLowerCase()}: ${value}`)
                }
                onGenerate={generate}
              />
            )}

            {options && options.length > 0 && !loading && (
              <div className="flex flex-wrap gap-2">
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
          </>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3">
              <Typing hint={hint} />
            </div>
          </div>
        )}
      </div>

      {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

      {/* Quick suggestions, only before the first message */}
      {empty && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => send(s.text)}
              className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={
              ready ? "Tweak the brief, or hit Generate" : "Describe the email you want…"
            }
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-surface-2 px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <Button
            variant="gradient"
            size="md"
            className="h-11 w-11 shrink-0 !px-0"
            onClick={() => send(input)}
            disabled={loading || generating || !input.trim()}
            aria-label="Send message"
          >
            <SendIcon size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
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
  onEditRow,
  onGenerate,
}: {
  card: BriefCard;
  disabled: boolean;
  ready: boolean;
  generating: boolean;
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
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface-2 p-3">
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
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="px-1 text-[12px] text-muted">
            Tap any row to edit, or generate now.
          </span>
          <Button
            variant="gradient"
            size="sm"
            onClick={onGenerate}
            loading={generating}
            disabled={disabled}
          >
            <SparkleIcon size={14} />
            {generating ? "Generating…" : "Generate"}
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
