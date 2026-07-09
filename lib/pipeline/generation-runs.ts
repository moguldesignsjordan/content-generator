import "server-only";
import { generateEmailForTopicStreamed, type GenerationEvent } from "./generate";
import { generateBlogForTopicStreamed } from "./generate-blog";
import {
  acquireGenerationLock,
  getDraftGenerationState,
  releaseGenerationLock,
} from "@/lib/db/queries";
import type {
  BlogType,
  CampaignBrief,
  ContentJobType,
  EmailType,
  TopicContext,
} from "@/lib/db/types";

type Listener = (event: GenerationEvent) => void;

interface Run {
  listeners: Set<Listener>;
  lastEvent: GenerationEvent | null;
}

/**
 * In-memory registry of in-flight generation runs, keyed by draft id. Lets
 * multiple SSE connections for the same draft on THIS instance (tab
 * reconnects, two tabs) bridge to a single underlying call instead of racing
 * duplicate generations. Cross-instance dedupe is a separate DB lock (see
 * acquireGenerationLock in lib/db/queries.ts) so a multi-instance deployment
 * can't start two Claude calls for the same draft either.
 */
const runs = new Map<string, Run>();

// Stay under the generate-stream route's 300s maxDuration so a foreign-owned
// run that never settles (a genuinely crashed peer) ends in a clean "error"
// event instead of the platform cutting the connection off mid-stream.
const POLL_TIMEOUT_MS = 280_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Starts a generation run for `draftId` if one isn't already active in this
 * process, then subscribes `listener` to it. Returns an unsubscribe function.
 * Subscribing always replays the run's last known event first, so a late
 * joiner doesn't miss the current phase.
 */
export function joinRun(
  draftId: string,
  ctx: TopicContext,
  opts: {
    campaignId?: string;
    jobType?: ContentJobType;
    emailTypeOverride?: EmailType;
    blogTypeOverride?: BlogType;
    briefOverride?: CampaignBrief;
    /** Campaign-series position (meta.series_seed_index); makes a series
     * email's style/layout rotation deterministic and distinct-by-index. */
    seedIndex?: number;
  },
  listener: Listener,
): () => void {
  let run = runs.get(draftId);

  if (!run) {
    const listeners = new Set<Listener>();
    const state: Run = { listeners, lastEvent: null };

    const emit = (event: GenerationEvent) => {
      state.lastEvent = event;
      for (const l of listeners) l(event);
    };

    void startRun(draftId, ctx, opts, emit).finally(() => {
      runs.delete(draftId);
    });

    run = state;
    runs.set(draftId, run);
  }

  run.listeners.add(listener);
  if (run.lastEvent) listener(run.lastEvent);

  return () => run!.listeners.delete(listener);
}

/**
 * Owns the work for `draftId` on this instance: either wins the cross-instance
 * DB lock and actually runs generation, or (another instance already owns it)
 * polls drafts.meta.generation until it settles. Either path emits the same
 * phase/done/error events, so listeners can't tell which one ran.
 */
async function startRun(
  draftId: string,
  ctx: TopicContext,
  opts: {
    campaignId?: string;
    jobType?: ContentJobType;
    emailTypeOverride?: EmailType;
    blogTypeOverride?: BlogType;
    briefOverride?: CampaignBrief;
    /** Campaign-series position (meta.series_seed_index); makes a series
     * email's style/layout rotation deterministic and distinct-by-index. */
    seedIndex?: number;
  },
  emit: (event: GenerationEvent) => void,
): Promise<void> {
  let owner: boolean;
  try {
    owner = await acquireGenerationLock(draftId);
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : "Generation failed.",
    });
    return;
  }

  if (!owner) {
    await pollUntilSettled(draftId, emit);
    return;
  }

  try {
    const runner =
      opts.jobType === "blog" ? generateBlogForTopicStreamed : generateEmailForTopicStreamed;
    await runner(draftId, ctx, opts, emit);
  } catch {
    // Errors are already surfaced to listeners via the runner's own "error"
    // event (and recorded on drafts.meta.generation); swallow here so this
    // promise doesn't produce an unhandled rejection once nothing awaits it.
  } finally {
    await releaseGenerationLock(draftId);
  }
}

/** Watches another instance's in-flight run via the DB instead of running a
 * second Claude call for the same draft. */
async function pollUntilSettled(
  draftId: string,
  emit: (event: GenerationEvent) => void,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastPhase: string | null = null;

  while (Date.now() < deadline) {
    const generation = await getDraftGenerationState(draftId).catch(() => null);
    if (generation) {
      if (generation.status === "ready") {
        emit({ type: "done" });
        return;
      }
      if (generation.status === "error") {
        emit({ type: "error", message: generation.error ?? "Generation failed." });
        return;
      }
      if (generation.phase !== lastPhase) {
        lastPhase = generation.phase;
        emit({ type: "phase", phase: generation.phase, label: generation.label });
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  emit({
    type: "error",
    message: "Generation is taking longer than expected. Try again.",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRunActive(draftId: string): boolean {
  return runs.has(draftId);
}
