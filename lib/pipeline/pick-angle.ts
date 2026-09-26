import "server-only";
import { DRAFT_MODEL, cacheableSystem, getAnthropic, logUsage } from "@/lib/clients/anthropic";
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
 * On DRAFT_MODEL at high effort, not Opus: it runs on every fresh email and
 * blog, and choosing between three proposed angles is well within Sonnet's
 * range.
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
      model: DRAFT_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [ANGLE_TOOL],
      tool_choice: { type: "tool", name: "choose_angle" },
    });
    logUsage("pick-angle", DRAFT_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
    usageDeltas.push({ model: DRAFT_MODEL, ...response.usage });

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
