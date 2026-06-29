"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, LinkButton } from "@/components/ui";
import { SendIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { OnboardingMessage } from "@/lib/db/types";
import { ONBOARDING_GREETING } from "@/prompts/onboarding";

interface ChatProps {
  brandId: string;
  initialMessages: OnboardingMessage[];
  alreadyComplete: boolean;
}

export function Chat({ brandId, initialMessages, alreadyComplete }: ChatProps) {
  const [messages, setMessages] = useState<OnboardingMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(alreadyComplete);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const showGreeting = messages.length === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);

    try {
      const res = await fetch("/api/onboarding/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, message: text }),
      });
      const data = (await res.json()) as {
        reply?: string;
        isComplete?: boolean;
        error?: string;
      };
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "Something went wrong.");
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply! }]);
      if (data.isComplete) setIsComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry, I hit a snag. Try sending that again, or refresh the page.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (alreadyComplete && messages.length === 0) {
    return (
      <Card className="p-7 text-center">
        <h2 className="font-display text-lg font-semibold">
          Your brand profile is set up
        </h2>
        <p className="mt-2 text-sm text-muted">
          You can refine anything anytime in Settings.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <LinkButton href="/settings" variant="subtle">
            Open Settings
          </LinkButton>
          <LinkButton href="/" variant="gradient">
            Go to dashboard
          </LinkButton>
        </div>
      </Card>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
      style={{ height: "clamp(440px, 68vh, 640px)" }}
    >
      {/* Thread */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 momentum">
        {showGreeting && <Bubble role="assistant" text={ONBOARDING_GREETING} />}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3">
              <Typing />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

      {/* Composer */}
      <div className="border-t border-border p-3">
        {isComplete ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-muted">
              All set, your brand profile is ready.
            </p>
            <LinkButton href="/" variant="gradient" size="sm">
              Finish → Dashboard
            </LinkButton>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type your answer…"
              disabled={loading}
            />
            <Button
              variant="gradient"
              className="h-11 w-11 shrink-0 !px-0"
              onClick={send}
              disabled={loading || !input.trim()}
              aria-label="Send"
            >
              <SendIcon size={18} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
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
        {text}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
