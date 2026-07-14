import "server-only";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import {
  EXTRACT_STYLE_TOOL,
  StyleProfileSchema,
  buildExtractStyleMessages,
} from "@/prompts/extract-style";
import type { ReferenceEmailStyleProfile } from "@/lib/db/types";
import { logError } from "@/lib/log";

// How much of a pasted email the extractor reads. Long enough for any real
// marketing email; guards against someone pasting a whole thread export.
const MAX_EXTRACT_CHARS = 12000;

/**
 * Distills the writing style of one uploaded reference email, once, at upload
 * time. Non-fatal by design: a failed extraction returns null and the email
 * is still saved (its raw text alone is a usable reference), so the library
 * never rejects an upload over a model hiccup.
 */
export async function extractEmailStyle(
  content: string,
): Promise<ReferenceEmailStyleProfile | null> {
  try {
    const { system, user } = buildExtractStyleMessages(
      content.slice(0, MAX_EXTRACT_CHARS),
    );
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      tools: [EXTRACT_STYLE_TOOL],
      tool_choice: { type: "tool", name: "save_style_profile" },
    });
    logUsage("reference-email-style", DRAFT_MODEL, response.usage);

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_style_profile",
    );
    if (!tu || tu.type !== "tool_use") return null;
    const parsed = StyleProfileSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:extract-style:invalid", parsed.error, {
        issues: parsed.error.issues,
      });
      return null;
    }
    return parsed.data;
  } catch (err) {
    logError("pipeline:extract-style", err);
    return null;
  }
}
