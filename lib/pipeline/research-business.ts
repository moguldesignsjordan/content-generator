import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import { DRAFT_MODEL, cacheableSystem, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import type { OnboardingInput } from "@/lib/db/types";
import type { BusinessResearch } from "@/lib/onboarding/proposal";
import {
  BUSINESS_RESEARCH_TOOLS,
  SAVE_BUSINESS_RESEARCH_TOOL,
  buildBusinessResearchMessages,
  parseBusinessResearch,
} from "@/prompts/research-business";
import { collectSources } from "./campaign-factory";

/** At most this many pause_turn resumes before the save is forced. */
const MAX_ROUNDS = 3;
/** The whole research turn's budget; onboarding moves on without it. */
const RESEARCH_BUDGET_MS = 75_000;

/**
 * Looks the business up on the web (reviews, listings, competitors) and
 * returns only what a returned URL backs. Throws on timeout or API error:
 * the caller carries on with the site data alone. Unmetered, like the
 * website import.
 */
export async function researchBusiness(
  input: OnboardingInput,
  opts: { brandId: string },
): Promise<BusinessResearch> {
  const { system, user } = buildBusinessResearchMessages(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const sources: { url: string; title: string }[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_BUDGET_MS);

  const call = (forceSave: boolean) =>
    getAnthropic()
      .messages.stream(
        {
          model: DRAFT_MODEL,
          max_tokens: 8000,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          system: cacheableSystem(system),
          messages,
          tools: [...BUSINESS_RESEARCH_TOOLS, SAVE_BUSINESS_RESEARCH_TOOL],
          tool_choice: forceSave
            ? { type: "tool", name: SAVE_BUSINESS_RESEARCH_TOOL.name }
            : { type: "auto" },
        },
        { signal: controller.signal },
      )
      .finalMessage();

  try {
    let forceSave = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await call(forceSave || round === MAX_ROUNDS - 1);
      logUsage("onboarding-research", DRAFT_MODEL, resp.usage, { brandId: opts.brandId });
      sources.push(...collectSources(resp.content));

      const save = resp.content.find(
        (b): b is Anthropic.ToolUseBlock =>
          b.type === "tool_use" && b.name === SAVE_BUSINESS_RESEARCH_TOOL.name,
      );
      if (save) {
        return parseBusinessResearch(save.input, { knownSources: sources, website: input.url });
      }

      // pause_turn: resend as-is and the server resumes the search loop.
      messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason !== "pause_turn") {
        messages.push({ role: "user", content: "Now call save_business_research with what you found." });
        forceSave = true;
      }
    }
    throw new Error("Business research didn't finish.");
  } finally {
    clearTimeout(timer);
  }
}
