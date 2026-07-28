import "server-only";
import { HARD_MODEL, cacheableSystem, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import { listTopPerformingEmails } from "@/lib/db/queries";
import type { CampaignBrief, TopicContext } from "@/lib/db/types";
import {
  ANGLE_TOOL,
  AngleSchema,
  buildAngleMessages,
  type AngleOutput,
} from "@/prompts/pick-angle";
import { logError } from "@/lib/log";
import type { UsageDelta } from "./cost";

/**
 * Picks the angle before drafting starts.
 *
 * This is the one place the pipeline spends Opus: it is a single short call
 * whose output shapes an entire piece, which is exactly the trade the
 * "Sonnet for drafts, Opus for hard pieces" rule was written for. Drafting
 * itself stays on DRAFT_MODEL because it runs on every generation, every
 * retry, and every QA revision.
 *
 * Non-fatal by design. A failed or malformed angle call returns null and
 * generation proceeds exactly as it did before this step existed: the angle is
 * an upgrade to the prompt, never a dependency of it.
 */
export async function pickAngle(
  ctx: TopicContext,
  opts: {
    brief?: CampaignBrief | null;
    channel?: "email" | "blog";
  } = {},
): Promise<{ angle: AngleOutput; usageDeltas: UsageDelta[] } | null> {
  const usageDeltas: UsageDelta[] = [];
  try {
    // Real send data when there is any; silently skipped when there isn't.
    const topPerformers = await listTopPerformingEmails(ctx.brand.id);
    const { system, user } = buildAngleMessages(ctx, { ...opts, topPerformers });

    const response = await getAnthropic().messages.create({
      model: HARD_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // xhigh, not the default: this is a judgment call worth thinking about,
      // and it's a few thousand tokens once per draft, not per retry.
      output_config: { effort: "xhigh" },
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [ANGLE_TOOL],
      tool_choice: { type: "tool", name: "choose_angle" },
    });
    logUsage("pick-angle", HARD_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
    usageDeltas.push({ model: HARD_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "choose_angle",
    );
    if (!tu || tu.type !== "tool_use") {
      logError(
        "pipeline:pick-angle",
        new Error(`Model did not call choose_angle (stop: ${response.stop_reason})`),
        { topicId: ctx.topic.id },
      );
      return null;
    }

    const parsed = AngleSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:pick-angle:invalid", parsed.error, {
        issues: parsed.error.issues,
        topicId: ctx.topic.id,
      });
      return null;
    }
    return { angle: parsed.data, usageDeltas };
  } catch (err) {
    logError("pipeline:pick-angle", err, { topicId: ctx.topic.id });
    return null;
  }
}

/** The angle the model chose, guarded against an out-of-range index. */
export function chosenAngle(output: AngleOutput | null | undefined) {
  if (!output) return null;
  return output.angles[output.chosen_index] ?? output.angles[0] ?? null;
}
