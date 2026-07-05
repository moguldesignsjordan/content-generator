import "server-only";
import { generateEmailForTopicStreamed, type GenerationEvent } from "./generate";
import { generateBlogForTopicStreamed } from "./generate-blog";
import type { ContentJobType, TopicContext } from "@/lib/db/types";

type Listener = (event: GenerationEvent) => void;

interface Run {
  listeners: Set<Listener>;
  lastEvent: GenerationEvent | null;
  promise: Promise<void>;
}

/**
 * In-memory registry of in-flight generation runs, keyed by draft id. Lets
 * multiple SSE connections for the same draft (tab reconnects, two tabs)
 * bridge to a single underlying Claude call instead of racing duplicate
 * generations. Single-instance only: a multi-instance deployment would need
 * a shared store (Redis pub/sub or similar) instead of this module-level Map.
 */
const runs = new Map<string, Run>();

/**
 * Starts a generation run for `draftId` if one isn't already active in this
 * process, then subscribes `listener` to it. Returns an unsubscribe function.
 * Subscribing always replays the run's last known event first, so a late
 * joiner doesn't miss the current phase.
 */
export function joinRun(
  draftId: string,
  ctx: TopicContext,
  opts: { campaignId?: string; jobType?: ContentJobType },
  listener: Listener,
): () => void {
  let run = runs.get(draftId);

  if (!run) {
    const listeners = new Set<Listener>();
    const state: Run = { listeners, lastEvent: null, promise: Promise.resolve() };

    const emit = (event: GenerationEvent) => {
      state.lastEvent = event;
      for (const l of listeners) l(event);
    };

    const runner =
      opts.jobType === "blog"
        ? generateBlogForTopicStreamed
        : generateEmailForTopicStreamed;
    state.promise = runner(draftId, ctx, opts, emit)
      .catch(() => {
        // Errors are already surfaced to listeners via the "error" event;
        // swallow here so the run's own promise doesn't produce an
        // unhandled rejection once nothing is awaiting it.
      })
      .finally(() => {
        runs.delete(draftId);
      });

    run = state;
    runs.set(draftId, run);
  }

  run.listeners.add(listener);
  if (run.lastEvent) listener(run.lastEvent);

  return () => run!.listeners.delete(listener);
}

export function isRunActive(draftId: string): boolean {
  return runs.has(draftId);
}
