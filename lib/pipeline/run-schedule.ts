import "server-only";
import { computeNextRunAt, nextSocialPostDates } from "@/lib/scheduling/cadence";
import { joinRun } from "./generation-runs";
import {
  createDraftShell,
  getNextIdeaTopicId,
  getTopicContext,
  listSocialTopicCandidates,
  markScheduleRun,
} from "@/lib/db/queries";
import type { ContentSchedule, TopicContext } from "@/lib/db/types";

export interface ScheduleRunResult {
  scheduleId: string;
  status: "generated" | "skipped" | "error";
  draftId?: string;
  message?: string;
}

/**
 * Runs one due schedule to completion: picks the oldest un-started topic,
 * creates a draft shell, and drives generation headlessly through the same
 * joinRun/DB-lock pipeline the SSE route uses (see generate-stream/route.ts),
 * just resolving a promise on the terminal event instead of writing SSE
 * chunks. The draft lands in_review exactly like a manual one, so the
 * approval gate is inherited for free.
 */
export async function runDueSchedule(schedule: ContentSchedule): Promise<ScheduleRunResult> {
  const now = new Date().toISOString();
  if (schedule.channel === "social") return runSocialSchedule(schedule, now);

  const topicId = await getNextIdeaTopicId(schedule.brand_id);
  if (!topicId) {
    await markScheduleRun(schedule.id, {
      next_run_at: computeNextRunAt(schedule.cadence, now),
      last_run_at: now,
      last_result: "skipped: no topics available",
    });
    return { scheduleId: schedule.id, status: "skipped", message: "no topics available" };
  }

  try {
    const ctx = await getTopicContext(topicId);
    if (!ctx) throw new Error(`Topic ${topicId} not found`);

    const draftId = await createDraftShell({
      ctx,
      type: schedule.channel,
      emailType: schedule.email_type ?? undefined,
      blogType: schedule.blog_type ?? undefined,
      triggerSource: "schedule",
    });

    await runGenerationToCompletion(draftId, ctx, schedule);

    await markScheduleRun(schedule.id, {
      next_run_at: computeNextRunAt(schedule.cadence, now),
      last_run_at: now,
      last_result: `generated draft ${draftId}`,
    });
    return { scheduleId: schedule.id, status: "generated", draftId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await markScheduleRun(schedule.id, {
      last_run_at: now,
      last_result: `error: ${message}`,
    });
    return { scheduleId: schedule.id, status: "error", message };
  }
}

/**
 * The weekly social batch: one flyer per posting day (Mon/Wed/Fri), each
 * dated in meta.planned_publish_at. They land in_review like any draft; the
 * Social page approves the week in one click and the daily cron posts each on
 * its day. Generated one after another to stay inside the cron's time limit.
 * Advances the schedule if at least one post was written.
 */
async function runSocialSchedule(
  schedule: ContentSchedule,
  now: string,
): Promise<ScheduleRunResult> {
  const dates = nextSocialPostDates(new Date(now));
  const topicIds = await listSocialTopicCandidates(schedule.brand_id, dates.length);
  if (!topicIds.length) {
    await markScheduleRun(schedule.id, {
      next_run_at: computeNextRunAt(schedule.cadence, now),
      last_run_at: now,
      last_result: "skipped: no topics left without a flyer",
    });
    return { scheduleId: schedule.id, status: "skipped", message: "no topics available" };
  }

  const draftIds: string[] = [];
  const errors: string[] = [];
  for (const [i, topicId] of topicIds.entries()) {
    try {
      const ctx = await getTopicContext(topicId);
      if (!ctx) throw new Error(`Topic ${topicId} not found`);
      const draftId = await createDraftShell({
        ctx,
        type: "social",
        // 4:5 is the tallest size both the Facebook and Instagram feeds take.
        flyerAspect: "4:5",
        triggerSource: "schedule",
        plannedPublishAt: dates[i],
      });
      await runGenerationToCompletion(draftId, ctx, schedule);
      draftIds.push(draftId);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Generation failed.");
    }
  }

  if (!draftIds.length) {
    await markScheduleRun(schedule.id, {
      last_run_at: now,
      last_result: `error: ${errors[0]}`,
    });
    return { scheduleId: schedule.id, status: "error", message: errors[0] };
  }

  const short = topicIds.length < dates.length ? ` (only ${topicIds.length} topics left)` : "";
  const failed = errors.length ? `, ${errors.length} failed: ${errors[0]}` : "";
  await markScheduleRun(schedule.id, {
    next_run_at: computeNextRunAt(schedule.cadence, now),
    last_run_at: now,
    last_result: `generated ${draftIds.length} social posts${short}${failed}`,
  });
  return { scheduleId: schedule.id, status: "generated", draftId: draftIds[0] };
}

/** Bridges joinRun's listener callback to a promise: resolves on "done",
 * rejects on "error". No SSE, no browser involved. */
function runGenerationToCompletion(
  draftId: string,
  ctx: TopicContext,
  schedule: ContentSchedule,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = joinRun(
      draftId,
      ctx,
      {
        jobType: schedule.channel,
        emailTypeOverride: schedule.email_type ?? undefined,
        blogTypeOverride: schedule.blog_type ?? undefined,
      },
      (event) => {
        if (event.type === "done") {
          unsubscribe();
          resolve();
        } else if (event.type === "error") {
          unsubscribe();
          reject(new Error(event.message));
        }
      },
    );
  });
}
