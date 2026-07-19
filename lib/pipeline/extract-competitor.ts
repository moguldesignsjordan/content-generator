import "server-only";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import {
  EXTRACT_COMPETITOR_TOOL,
  CompetitorProfileSchema,
  buildExtractCompetitorMessages,
} from "@/prompts/extract-competitor";
import type { CompetitorProfile } from "@/lib/db/types";
import { logError } from "@/lib/log";

// How much of a pasted/scraped ad the extractor reads. Same budget as
// extract-style.ts's reference emails.
const MAX_EXTRACT_CHARS = 12000;

/**
 * Distills the marketing STRATEGY of one saved competitor ad, once, at save
 * time. Vision-capable: pass imageUrl for a screenshot (already hosted,
 * attached the same way the create chat attaches images to Claude), content
 * for pasted/scraped text, or both. Non-fatal by design: a failed extraction
 * returns null and the reference is still saved (its raw content/image alone
 * is a usable reference), so the library never rejects a save over a model
 * hiccup.
 */
export async function extractCompetitorProfile(input: {
  content?: string;
  imageUrl?: string;
}): Promise<CompetitorProfile | null> {
  const content = input.content?.slice(0, MAX_EXTRACT_CHARS);
  if (!content && !input.imageUrl) return null;

  try {
    const { system, user } = buildExtractCompetitorMessages(content);
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: input.imageUrl
            ? [
                {
                  type: "image" as const,
                  source: { type: "url" as const, url: input.imageUrl },
                },
                { type: "text" as const, text: user },
              ]
            : user,
        },
      ],
      tools: [EXTRACT_COMPETITOR_TOOL],
      tool_choice: { type: "tool", name: "save_competitor_profile" },
    });
    logUsage("competitor-reference-profile", DRAFT_MODEL, response.usage);

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_competitor_profile",
    );
    if (!tu || tu.type !== "tool_use") return null;
    const parsed = CompetitorProfileSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:extract-competitor:invalid", parsed.error, {
        issues: parsed.error.issues,
      });
      return null;
    }
    return parsed.data;
  } catch (err) {
    logError("pipeline:extract-competitor", err);
    return null;
  }
}
