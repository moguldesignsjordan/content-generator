"use client";

import { useEffect, useRef, useState } from "react";

export interface GenerationStreamState {
  status: "generating" | "ready" | "error";
  phase: string;
  label: string;
  error?: string;
  /** True when the error is "you're out of credits" (see guardDraftAiRoute in
   *  the generate-stream route), not a generic failure — the UI shows a Buy
   *  credits CTA instead of a plain Retry. */
  outOfCredits?: boolean;
  upgradeUrl?: string;
}

/**
 * Opens the /api/drafts/[id]/generate-stream SSE connection and exposes the
 * live phase/label/status. Reconnecting (new draftId, or bumping `retryKey`)
 * re-opens the connection; the server-side run is idempotent, so a reconnect
 * either replays the current phase or starts a fresh run if none is active.
 */
export function useGenerationStream(
  draftId: string,
  initial?: { phase?: string; label?: string },
): GenerationStreamState & { retry: () => void } {
  const [state, setState] = useState<GenerationStreamState>({
    status: "generating",
    phase: initial?.phase ?? "queued",
    label: initial?.label ?? "Starting",
  });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      try {
        const res = await fetch(`/api/drafts/${draftId}/generate-stream`, {
          signal: controller.signal,
        });
        if (!res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const messages = buffer.split("\n\n");
          buffer = messages.pop() ?? "";

          for (const message of messages) {
            let event = "message";
            let data = "";
            for (const line of message.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data = line.slice(5).trim();
            }
            if (!data) continue;
            const parsed = JSON.parse(data) as {
              phase?: string;
              label?: string;
              message?: string;
              outOfCredits?: boolean;
              upgradeUrl?: string;
            };

            if (event === "phase") {
              setState({ status: "generating", phase: parsed.phase!, label: parsed.label! });
            } else if (event === "done") {
              setState((s) => ({ ...s, status: "ready" }));
            } else if (event === "error") {
              setState((s) => ({
                ...s,
                status: "error",
                error: parsed.message,
                outOfCredits: parsed.outOfCredits,
                upgradeUrl: parsed.upgradeUrl,
              }));
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setState((s) => ({ ...s, status: "error", error: "Connection lost." }));
        }
      }
    }

    run();
    return () => controller.abort();
  }, [draftId, retryKey]);

  return { ...state, retry: () => setRetryKey((k) => k + 1) };
}
