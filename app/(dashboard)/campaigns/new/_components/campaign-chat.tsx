"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { SendIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { CampaignBrief, OnboardingMessage } from "@/lib/db/types";
import type { SuggestedOption, VoiceProposals } from "@/prompts/campaign";
import { CAMPAIGN_GREETING } from "@/prompts/campaign";

type TurnResponse = {
  reply?: string;
  campaignId?: string;
  topicId?: string | null;
  brief?: CampaignBrief;
  proposals?: VoiceProposals | null;
  options?: SuggestedOption[] | null;
  readyToGenerate?: boolean;
  error?: string;
};

/** Resumed state from the brand's most recent in-flight campaign, so a hard
 * refresh of /campaigns/new picks the thread back up instead of losing it. */
export interface CampaignChatInitialState {
  campaignId: string;
  messages: OnboardingMessage[];
  topicId: string | null;
  brief: CampaignBrief;
  readyToGenerate: boolean;
}

// Requests can chain a couple of retry calls server-side; abort well before
// the route's own maxDuration (120s) so a hung request surfaces as an error
// instead of spinning the typing indicator forever.
const REQUEST_TIMEOUT_MS = 110_000;

export function CampaignChat({ initial }: { initial?: CampaignChatInitialState }) {
  const router = useRouter();
  const [messages, setMessages] = useState<OnboardingMessage[]>(initial?.messages ?? []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.campaignId ?? null);
  const [topicId, setTopicId] = useState<string | null>(initial?.topicId ?? null);
  const [brief, setBrief] = useState<CampaignBrief>(initial?.brief ?? {});
  const [proposals, setProposals] = useState<VoiceProposals | null>(null);
  const [options, setOptions] = useState<SuggestedOption[] | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  const [readyToGenerate, setReadyToGenerate] = useState(initial?.readyToGenerate ?? false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, proposals, readyToGenerate, generating]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || loading || generating) return;
    setInput("");
    setLoading(true);
    setError(null);
    setOptions(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    const hintTimer = setTimeout(() => setHint(true), 6000);
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/campaigns/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, message: text }),
        signal: controller.signal,
      });
      const data = (await res.json()) as TurnResponse;
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "Something went wrong.");
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply! }]);
      if (data.campaignId) setCampaignId(data.campaignId);
      if (data.topicId !== undefined) setTopicId(data.topicId);
      if (data.brief) setBrief(data.brief);
      if (data.proposals) setProposals(data.proposals);
      if (data.options?.length) setOptions(data.options);
      if (data.readyToGenerate) setReadyToGenerate(true);
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
      setHint(false);
      setLoading(false);
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
    setCampaignId(null);
    setTopicId(null);
    setBrief({});
    setProposals(null);
    setOptions(null);
    setReadyToGenerate(false);
    setGenerating(false);
    setError(null);
  }

  async function applyVoice() {
    if (!proposals || savingVoice) return;
    setSavingVoice(true);
    try {
      const res = await fetch("/api/campaigns/apply-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals }),
      });
      if (!res.ok) throw new Error("Failed to save voice updates.");
      setProposals(null);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Saved to your brand voice. It'll shape every draft from here on." },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save voice updates.");
    } finally {
      setSavingVoice(false);
    }
  }

  async function generate() {
    if (!topicId || generating) return;
    setGenerating(true);
    setError(null);
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
      setGenerating(false);
      setError(err instanceof Error ? err.message : "Generation failed.");
    }
  }

  const briefChips = [
    brief.goal && `Goal: ${brief.goal}`,
    brief.key_message && `Message: ${brief.key_message}`,
    brief.offer_slug && `Offer: ${brief.offer_slug}`,
    topicId && "Topic attached",
  ].filter(Boolean) as string[];

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
      style={{ height: "clamp(440px, 68vh, 640px)" }}
    >
      {(briefChips.length > 0 || messages.length > 0) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {briefChips.map((chip) => (
              <span
                key={chip}
                className="max-w-[260px] truncate rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] text-muted"
              >
                {chip}
              </span>
            ))}
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {confirmClear ? "Confirm clear?" : "Clear chat"}
            </button>
          )}
        </div>
      )}

      {/* Thread */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 momentum">
        {messages.length === 0 && (
          <Bubble role="assistant" text={CAMPAIGN_GREETING} />
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}

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

        {proposals && (
          <Card className="ml-0 max-w-[92%] p-4">
            <p className="text-[13px] font-semibold text-foreground">
              Keep this in your brand voice?
            </p>
            {proposals.note && (
              <p className="mt-1 text-[12.5px] text-muted">{proposals.note}</p>
            )}
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-foreground">
              {proposals.voice && <li>Voice: {proposals.voice}</li>}
              {proposals.tone && <li>Tone: {proposals.tone}</li>}
              {proposals.banned_terms_add?.length ? (
                <li>Never say: {proposals.banned_terms_add.join(", ")}</li>
              ) : null}
              {proposals.example_lines?.map((l, i) => (
                <li key={i} className="italic">&ldquo;{l}&rdquo;</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="gradient"
                onClick={applyVoice}
                disabled={savingVoice}
              >
                {savingVoice ? "Saving…" : "Save to brand voice"}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setProposals(null)}>
                Not now
              </Button>
            </div>
          </Card>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3">
              <Typing hint={hint} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

      {/* Composer / handoff */}
      <div className="border-t border-border p-3">
        {generating ? (
          <div className="flex items-center gap-3 px-1 py-1.5">
            <Spinner />
            <p className="text-[14px] text-muted">Opening your draft…</p>
          </div>
        ) : readyToGenerate && topicId ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-muted">Brief's ready.</p>
            <Button variant="gradient" size="sm" onClick={generate}>
              Generate the email
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Tell me about this campaign…"
              disabled={loading}
            />
            <Button
              variant="gradient"
              className="h-11 w-11 shrink-0 !px-0"
              onClick={() => send()}
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
        <span className="text-[11px] text-muted-2">still thinking…</span>
      )}
    </div>
  );
}
