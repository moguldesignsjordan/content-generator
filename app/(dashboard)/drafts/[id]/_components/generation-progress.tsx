"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, LinkButton, Progress } from "@/components/ui";
import { useGenerationStream } from "@/lib/use-generation-stream";

/**
 * Renders in place of the review screen while a draft shell is being filled
 * in. Streams real phase progress via SSE, no fake rotating status text.
 */
export function GenerationProgress({
  draftId,
  topicTitle,
  initialPhase,
  initialLabel,
}: {
  draftId: string;
  topicTitle?: string | null;
  initialPhase?: string;
  initialLabel?: string;
}) {
  const router = useRouter();
  const state = useGenerationStream(draftId, {
    phase: initialPhase,
    label: initialLabel,
  });

  useEffect(() => {
    if (state.status === "ready") router.refresh();
  }, [state.status, router]);

  return (
    <Card className="mx-auto mt-6 max-w-md p-8 text-center">
      <Progress
        variant="ring"
        indeterminate
        size={56}
        label={state.label}
        className="mx-auto"
      />
      {topicTitle && (
        <p className="mt-5 text-[15px] font-medium text-foreground">{topicTitle}</p>
      )}
      {state.status === "error" ? (
        <>
          <p className="mt-2 text-[13px] text-danger">
            {state.error ?? "Something went wrong."}
          </p>
          {state.outOfCredits ? (
            <LinkButton href={state.upgradeUrl ?? "/billing"} variant="gradient" className="mt-4">
              Buy credits
            </LinkButton>
          ) : (
            <Button className="mt-4" onClick={state.retry}>
              Retry
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-muted">{state.label}</p>
          <div className="mt-5 h-px w-full bg-border" />
          <p className="mt-3 text-[12px] text-muted-2">
            This usually takes about a minute
          </p>
        </>
      )}
    </Card>
  );
}
