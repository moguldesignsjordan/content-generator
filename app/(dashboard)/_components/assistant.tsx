"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ChevronRightIcon, SendIcon, SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface Msg {
  role: "user" | "assistant";
  content: string;
  draftId?: string;
}

export interface AssistantSuggestion {
  label: string;
  text: string;
}

/**
 * The content assistant: a reusable chat that posts to /api/assistant/chat.
 * Bubbles, typing dots with a slow hint, auto-grow composer, gradient send.
 * The assistant can answer brand questions and kick off email generation,
 * then deep-link to the new draft.
 */
export function Assistant({
  suggestions = [],
  className,
}: {
  suggestions?: AssistantSuggestion[];
  className?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || loading) return;
    setInput("");
    setError(null);
    setHint(false);
    setMessages((m) => [...m, { role: "user", content: t }]);
    setLoading(true);
    const hintTimer = setTimeout(() => setHint(true), 6000);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, history: messages }),
      });
      const data = (await res.json()) as {
        reply?: string;
        draftId?: string;
        error?: string;
      };
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "Something went wrong.");
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply!, draftId: data.draftId },
      ]);
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
              Ask Mogul to draft, critique, or plan
            </p>
            <p className="mt-1 text-[13px] text-muted">
              e.g. &ldquo;Draft an email about brand pillars&rdquo;
            </p>
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={i} msg={m} />)
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
            placeholder="Message Mogul…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-surface-2 px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <Button
            variant="gradient"
            size="md"
            className="h-11 w-11 shrink-0 !px-0"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
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
      <div className="max-w-[85%] space-y-2">
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed",
            isUser
              ? "rounded-br-sm bg-accent text-white"
              : "rounded-bl-sm bg-surface-2 text-foreground",
          )}
        >
          {msg.content}
        </div>
        {msg.draftId && (
          <Link
            href={`/drafts/${msg.draftId}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-press"
          >
            Open draft
            <ChevronRightIcon size={15} />
          </Link>
        )}
      </div>
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
