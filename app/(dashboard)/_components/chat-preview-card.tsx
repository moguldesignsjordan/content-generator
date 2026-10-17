"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AccentSpinner, Badge, Button, LinkButton, buttonClasses } from "@/components/ui";
import { CheckIcon, DownloadIcon, RefreshIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useGenerationStream } from "@/lib/use-generation-stream";
import { flyerEditRerenders, type FlyerEditAction, type PreviewAction } from "@/lib/chat-preview";
import type { ChatPreviewRef, ContentImage } from "@/lib/db/types";
import { PIECE_ART } from "./art";
import { DraftStateBadge } from "./topic-badges";

export interface ChatPreview {
  draftId: string;
  channel: ChatPreviewRef["channel"];
}

/** A change the agent asked for. `nonce` lets the same change run twice. */
export interface QueuedPreviewAction {
  action: PreviewAction;
  nonce: number;
}

interface PreviewData {
  /** The newest version's id (a revise makes a new one). */
  id: string;
  state: string;
  subject: string;
  flyer?: {
    image: ContentImage | null;
    variants: { url: string; headline: string }[];
    index: number | null;
    /** "1:1", "4:5" or "9:16". */
    aspect: string;
  };
  html?: string;
}

const KIND_LABEL: Record<ChatPreview["channel"], string> = {
  social: "Flyer",
  email: "Email",
  blog: "Blog post",
};

/**
 * The piece the Create chat made, live in the thread: it streams the same
 * generation the review page does, then shows the result. Changes the agent
 * asks for (edit_flyer, revise_piece) run here through the review page's own
 * endpoints, so billing guards, timeouts, and saving stay in one place.
 */
export function ChatPreviewCard({
  preview,
  queued,
}: {
  preview: ChatPreview;
  queued: QueuedPreviewAction | null;
}) {
  const stream = useGenerationStream(preview.draftId);
  const [data, setData] = useState<PreviewData | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranNonce = useRef<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/drafts/${preview.draftId}/preview`);
    const body = (await res.json().catch(() => ({}))) as PreviewData & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "Couldn't load the preview.");
    setData(body);
  }, [preview.draftId]);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [preview.draftId]);

  useEffect(() => {
    if (stream.status !== "ready") return;
    load().catch((e: Error) => setError(e.message));
  }, [stream.status, load]);

  const run = useCallback(
    async (label: string, steps: () => Promise<void>) => {
      setWorking(label);
      setError(null);
      try {
        await steps();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change didn't go through.");
      } finally {
        // Reload either way: a multi-step change may have partly landed.
        await load().catch(() => {});
        setWorking(null);
      }
    },
    [load],
  );

  // Run each queued change once, after the piece has loaded.
  useEffect(() => {
    if (!queued || !data || ranNonce.current === queued.nonce) return;
    ranNonce.current = queued.nonce;
    const { action } = queued;
    if (action.kind === "revise") {
      void run("Rewriting it with your notes", () => revise(data.id, action.feedback));
    } else {
      void run(flyerLabel(action), () => editFlyer(data.id, action));
    }
  }, [queued, data, run]);

  const busy = working !== null;
  const failed = stream.status === "error";
  const inReview = data?.state === "in_review";
  const flyer = data?.flyer;
  const title = flyer ? flyer.variants[flyer.index ?? 0]?.headline : data?.subject;
  const elapsed = useElapsed(preview.draftId, !failed && !data);

  return (
    <div
      className={cn(
        "bubble-in overflow-hidden rounded-[22px] border bg-surface-2 transition-shadow duration-300",
        // Same payoff treatment as a ready brief: this is the thing to review.
        inReview && !busy ? "ring-spectrum glow-spectrum-soft border-transparent" : "border-border",
      )}
    >
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
        <span className="art-frame h-10 w-10 shrink-0 overflow-hidden rounded-[12px]">
          <Image src={PIECE_ART[preview.channel]} alt="" sizes="40px" className="h-full w-full scale-[1.2] object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            {KIND_LABEL[preview.channel]}
          </p>
          <p className="truncate text-[14px] font-semibold leading-snug text-foreground">
            {title || (failed ? "Not finished" : data ? KIND_LABEL[preview.channel] : "Being made")}
          </p>
        </div>
        {failed ? (
          <Badge tone="danger">Didn&apos;t finish</Badge>
        ) : !data ? (
          <Badge tone="magenta" dot>
            Making it
          </Badge>
        ) : inReview ? (
          <Badge tone="amber" dot>
            Needs review
          </Badge>
        ) : (
          <DraftStateBadge state={data.state} />
        )}
      </div>

      {failed ? (
        <>
          <MakingFrame channel={preview.channel} still />
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
            <p className="min-w-0 flex-1 text-[13px] text-danger">
              {stream.error ?? "It didn't finish generating."}
            </p>
            {stream.outOfCredits ? (
              <LinkButton href={stream.upgradeUrl ?? "/billing"} size="sm" variant="gradient">
                Top up credits
              </LinkButton>
            ) : (
              <Button size="sm" variant="outline" onClick={stream.retry}>
                <RefreshIcon size={15} />
                Try again
              </Button>
            )}
          </div>
        </>
      ) : !data ? (
        <>
          <MakingFrame channel={preview.channel} />
          <div className="flex items-center justify-between gap-3 px-3.5 py-3" role="status" aria-live="polite">
            <span className="flex min-w-0 items-center gap-2">
              <AccentSpinner size={14} />
              <span className="text-shimmer truncate text-[13px] font-medium">
                {stream.status === "ready" ? "Loading the preview" : stream.label}
              </span>
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-2">{formatElapsed(elapsed)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="px-3.5">
            {flyer ? (
              flyer.image && (
                <div className="relative mx-auto w-fit overflow-hidden rounded-[var(--radius-md)] bg-surface-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={flyer.image.url} alt={flyer.image.alt} className="block max-h-[460px] w-auto" />
                  {busy && <WorkingOverlay label={working} />}
                </div>
              )
            ) : (
              <div className="relative">
                <ScaledHtml html={data.html ?? ""} />
                {busy && <WorkingOverlay label={working} />}
              </div>
            )}
          </div>

          {flyer && flyer.variants.length > 1 && (
            <div className="px-3.5 pt-3">
              <p className="mb-2 flex items-baseline gap-2 text-[12px]">
                <span className="font-semibold text-foreground">{flyer.variants.length} options</span>
                {inReview && <span className="text-muted-2">Tap one to switch</span>}
              </p>
              <div className="grid max-w-[400px] grid-cols-3 gap-2">
                {flyer.variants.map((v, i) => {
                  const on = i === flyer.index;
                  return (
                    <button
                      key={v.url}
                      type="button"
                      disabled={busy || !inReview || on}
                      aria-label={`Option ${i + 1}: ${v.headline}`}
                      aria-pressed={on}
                      onClick={() => void run("Switching options", () => editFlyer(data.id, { kind: "flyer", option: i + 1 }))}
                      style={{ aspectRatio: flyer.aspect.replace(":", " / ") }}
                      className={cn(
                        "relative overflow-hidden rounded-[12px] bg-surface-3 ring-2 ring-offset-2 ring-offset-surface-2 transition-[box-shadow,opacity,transform] duration-200 active:scale-[0.97]",
                        on ? "ring-accent" : "ring-transparent hover:ring-border-strong disabled:opacity-60",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      <span
                        className={cn(
                          "absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white",
                          on ? "bg-accent" : "bg-black/60",
                        )}
                      >
                        {on ? <CheckIcon size={11} /> : i + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 border-t border-border px-3.5 py-2.5">
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-muted-2">
              {error ? (
                <span className="text-danger">{error}</span>
              ) : inReview ? (
                "Tell me what to change, or open it to approve."
              ) : (
                "This version is no longer in review."
              )}
            </p>
            {flyer?.image && (
              <a
                href={flyer.image.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download the flyer"
                title="Download the flyer"
                className={buttonClasses({ variant: "ghost", size: "sm", className: "!px-2.5" })}
              >
                <DownloadIcon size={16} />
              </a>
            )}
            <LinkButton href={`/drafts/${data.id}`} size="sm" variant={inReview ? "gradient" : "outline"}>
              {inReview ? "Review" : "Open"}
            </LinkButton>
          </div>
        </>
      )}
    </div>
  );
}

/** The piece's stand-in while it's made: its glass art in a dark frame at
 * roughly the piece's shape, with a light sweep and a spectrum progress bar.
 * `still` (the error state) drops the motion and dims the art. */
function MakingFrame({ channel, still }: { channel: ChatPreview["channel"]; still?: boolean }) {
  return (
    <div className="px-3.5">
      <div
        className={cn(
          "art-frame relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-[var(--radius-md)]",
          channel === "social" ? "aspect-square max-w-[360px]" : "aspect-[16/10]",
        )}
      >
        <Image
          src={PIECE_ART[channel]}
          alt=""
          sizes="240px"
          placeholder="blur"
          className={cn(
            "h-auto w-[62%] max-w-[240px] object-contain",
            still ? "opacity-35 grayscale" : "art-float",
          )}
        />
        {!still && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"
              style={{ animation: "progress-indeterminate 2.6s ease-in-out infinite" }}
            />
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-white/10">
              <span
                className="bg-spectrum block h-full w-1/3 rounded-full"
                style={{ animation: "progress-indeterminate 1.3s ease-in-out infinite" }}
              />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Dims the finished piece while a change runs on it. Dark in both themes so
 * the label reads over any flyer or email. */
function WorkingOverlay({ label }: { label: ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-black/55 text-[13px] font-medium text-white backdrop-blur-[3px]"
      role="status"
      aria-live="polite"
    >
      <AccentSpinner size={14} />
      {label}
    </div>
  );
}

/** Whole seconds since `key` started running, ticking only while `active`. */
function useElapsed(key: string, active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
  }, [key]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** An email or blog body at its real width, scaled down to fit the card and
 * scrollable inside. Sandboxed: no scripts run in the preview. */
function ScaledHtml({ html }: { html: string }) {
  const WIDTH = 640;
  const HEIGHT = 440;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-white" style={{ height: HEIGHT }}>
      <iframe
        title="Preview"
        sandbox=""
        srcDoc={html}
        style={{ width: WIDTH, height: HEIGHT / scale, transform: `scale(${scale})`, transformOrigin: "top left" }}
        className="block border-0"
      />
    </div>
  );
}

function flyerLabel(action: FlyerEditAction): string {
  if (action.photo_url) return action.photo_use === "style" ? "Restyling it from your photo" : "Adding your photo";
  if (action.pro) return "Rendering it on Pro";
  if (flyerEditRerenders(action)) return "Updating the flyer";
  return "Switching options";
}

async function postFlyer(draftId: string, fields: Record<string, string | Blob>): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const res = await fetch(`/api/drafts/${draftId}/flyer`, { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't update the flyer.");
  }
}

/** Runs a flyer change in order: pick an option, re-render it, then add the photo. */
async function editFlyer(draftId: string, action: FlyerEditAction): Promise<void> {
  if (action.option) await postFlyer(draftId, { mode: "pick", index: String(action.option - 1) });
  if (flyerEditRerenders(action)) {
    const fields: Record<string, string> = { mode: "generate" };
    if (action.headline !== undefined) fields.headline = action.headline;
    if (action.subtext !== undefined) fields.subtext = action.subtext;
    if (action.scene !== undefined) fields.scene = action.scene;
    if (action.pro) fields.tier = "pro";
    await postFlyer(draftId, fields);
  }
  if (action.photo_url) {
    const photo = await fetch(action.photo_url);
    if (!photo.ok) throw new Error("Couldn't load that photo.");
    const blob = await photo.blob();
    await postFlyer(draftId, {
      mode: "generate",
      reference: new File([blob], "photo", { type: blob.type || "image/jpeg" }),
      referenceRole: action.photo_use ?? "place",
      ...(action.note ? { referenceNote: action.note } : {}),
    });
  }
}

/** A new version with the owner's notes; the preview follows it on reload. */
async function revise(draftId: string, feedback: string): Promise<void> {
  const res = await fetch(`/api/drafts/${draftId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    capped?: boolean;
    notInReview?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "Couldn't revise it.");
  if (body.capped) throw new Error("This piece hit its revision limit. Open review to edit it by hand.");
  if (body.notInReview) throw new Error("It's no longer in review, so it can't change.");
}
