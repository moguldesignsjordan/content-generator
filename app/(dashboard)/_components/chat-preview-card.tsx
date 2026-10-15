"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccentSpinner, LinkButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useGenerationStream } from "@/lib/use-generation-stream";
import { flyerEditRerenders, type FlyerEditAction, type PreviewAction } from "@/lib/chat-preview";
import type { ChatPreviewRef, ContentImage } from "@/lib/db/types";

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
  flyer?: {
    image: ContentImage | null;
    variants: { url: string; headline: string }[];
    index: number | null;
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

  return (
    <div className="bubble-in overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface-2">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          <span className="bar-spectrum h-1 w-4 rounded-full" />
          {KIND_LABEL[preview.channel]}
        </span>
        {data && (
          <LinkButton href={`/drafts/${data.id}`} size="sm" variant="outline">
            Open review
          </LinkButton>
        )}
      </div>

      {stream.status === "error" ? (
        <div className="space-y-2 px-3 pb-3 text-[13px]">
          <p className="text-danger">{stream.error ?? "It didn't finish generating."}</p>
          <button type="button" className="font-medium text-accent hover:text-accent-press" onClick={stream.retry}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 px-3 pb-3 text-[13px] text-muted">
          <AccentSpinner size={14} />
          {stream.status === "ready" ? "Loading the preview" : stream.label}
        </div>
      ) : (
        <>
          <div className="relative px-3">
            {data.flyer ? (
              data.flyer.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.flyer.image.url}
                  alt={data.flyer.image.alt}
                  className="mx-auto max-h-[460px] w-auto rounded-[var(--radius-md)]"
                />
              )
            ) : (
              <ScaledHtml html={data.html ?? ""} />
            )}
            {busy && (
              <div className="absolute inset-0 mx-3 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-surface-2/80 text-[13px] font-medium text-foreground">
                <AccentSpinner size={14} />
                {working}
              </div>
            )}
          </div>

          {data.flyer && data.flyer.variants.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-2">
              {data.flyer.variants.map((v, i) => (
                <button
                  key={v.url}
                  type="button"
                  disabled={busy || data.state !== "in_review"}
                  aria-label={`Option ${i + 1}: ${v.headline}`}
                  aria-pressed={i === data.flyer?.index}
                  onClick={() => void run("Switching options", () => editFlyer(data.id, { kind: "flyer", option: i + 1 }))}
                  className={cn(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border-2 transition-colors disabled:opacity-60",
                    i === data.flyer?.index ? "border-accent" : "border-transparent hover:border-border-strong",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          <p className="px-3 py-2.5 text-[12px] text-muted-2">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : data.state === "in_review" ? (
              "Tell me what to change, or open review to approve it."
            ) : (
              `This version is ${data.state}.`
            )}
          </p>
        </>
      )}
    </div>
  );
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
    if (action.cta !== undefined) fields.cta = action.cta;
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
