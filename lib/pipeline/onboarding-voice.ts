import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import type { OnboardingProposal, VoiceSample } from "@/lib/db/types";
import {
  SAVE_VOICE_SAMPLES_TOOL,
  VOICE_SAMPLE_COUNT,
  buildVoiceRewriteMessages,
  buildVoiceSampleMessages,
  cleanVoiceSamples,
} from "@/prompts/onboarding-voice";

async function callSamples(
  messages: { system: string; user: string },
  brandId: string,
): Promise<unknown> {
  const response = await getAnthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: 2048,
    system: messages.system,
    messages: [{ role: "user", content: messages.user }],
    tools: [SAVE_VOICE_SAMPLES_TOOL],
    tool_choice: { type: "tool", name: SAVE_VOICE_SAMPLES_TOOL.name },
  });
  logUsage("onboarding-voice", DRAFT_MODEL, response.usage, { brandId });
  const tu = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SAVE_VOICE_SAMPLES_TOOL.name,
  );
  return tu?.input;
}

/** Three samples about one of the owner's real services, in three voices.
 * Unmetered: onboarding never spends the owner's credits. */
export async function writeVoiceSamples(
  proposal: OnboardingProposal,
  opts: { brandId: string },
): Promise<VoiceSample[]> {
  const input = await callSamples(buildVoiceSampleMessages(proposal), opts.brandId);
  return cleanVoiceSamples(input, {
    max: VOICE_SAMPLE_COUNT,
    hasSiteLines: proposal.example_lines.length > 0,
  });
}

/** One picked sample, rewritten with a nudge or the owner's own words. Null
 * when the model returns nothing usable. */
export async function rewriteVoiceSample(
  proposal: OnboardingProposal,
  sample: Pick<VoiceSample, "name" | "voice" | "tone" | "text">,
  ask: string,
  opts: { brandId: string },
): Promise<VoiceSample | null> {
  const input = await callSamples(buildVoiceRewriteMessages(proposal, sample, ask), opts.brandId);
  return cleanVoiceSamples(input, { max: 1, hasSiteLines: false })[0] ?? null;
}
