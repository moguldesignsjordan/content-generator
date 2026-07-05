import { getDraftWithJobContext, getTopicContext } from "@/lib/db/queries";
import { joinRun } from "@/lib/pipeline/generation-runs";
import type { GenerationEvent } from "@/lib/pipeline/generate";

// A full generation (Claude + adaptive thinking) can take 30 to 90s; this
// connection stays open for the whole run.
export const maxDuration = 300;

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params;

  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) {
    return new Response("Draft not found", { status: 404 });
  }

  const generation = draftCtx.meta.generation;
  const alreadyReady = generation ? generation.status === "ready" : Boolean(draftCtx.content.html);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client disconnecting
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseChunk(event, data)));
        } catch {
          closed = true;
        }
      };

      if (alreadyReady) {
        send("done", {});
        close();
        return;
      }

      const onEvent = (event: GenerationEvent) => {
        if (event.type === "phase") {
          send("phase", { phase: event.phase, label: event.label });
        } else if (event.type === "done") {
          send("done", {});
          close();
        } else if (event.type === "error") {
          send("error", { message: event.message });
          close();
        }
      };

      try {
        const ctx = await getTopicContext(draftCtx.topicId);
        if (!ctx) throw new Error(`Topic ${draftCtx.topicId} not found`);

        // A retry after a prior error re-enters here too: joinRun finds no
        // active run for this draftId (regardless of DB status) and starts
        // a fresh one, overwriting the errored meta.generation as it goes.
        joinRun(
          draftId,
          ctx,
          { campaignId: draftCtx.campaignId ?? undefined, jobType: draftCtx.jobType },
          onEvent,
        );
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "Generation failed." });
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
