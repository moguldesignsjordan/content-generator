import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import { FAST_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import type { UsageDelta } from "./cost";
import { logWarn } from "@/lib/log";

const READ_TEXT_TOOL: Anthropic.Tool = {
  name: "report_text",
  description: "Report every piece of text visible in the image, exactly as spelled.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: { type: "string" },
        description:
          "Each separate text element, transcribed exactly as it appears, including misspellings. Empty if there is no text.",
      },
    },
    required: ["lines"],
  },
};

/**
 * Transcribes the text in a rendered flyer with one cheap Haiku vision call,
 * so an AI-typeset design can be checked against its copy before anyone sees
 * it. Returns null when the read itself fails; the caller then treats the
 * render as unverified and uses the safe code-set fallback.
 */
export async function readImageText(
  image: Buffer,
  opts: { brandId: string; draftId: string; usageDeltas: UsageDelta[] },
): Promise<string | null> {
  try {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
            { type: "text", text: "Transcribe every piece of text in this image exactly as spelled. Call report_text." },
          ],
        },
      ],
      tools: [READ_TEXT_TOOL],
      tool_choice: { type: "tool", name: READ_TEXT_TOOL.name },
    });
    logUsage("flyer-text-check", FAST_MODEL, response.usage, {
      brandId: opts.brandId,
      draftId: opts.draftId,
      metered: true,
      requestId: response.id,
    });
    opts.usageDeltas.push({ model: FAST_MODEL, ...response.usage });
    const tu = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === READ_TEXT_TOOL.name,
    );
    const lines = (tu?.input as { lines?: unknown } | undefined)?.lines;
    return Array.isArray(lines) ? lines.filter((l) => typeof l === "string").join("\n") : null;
  } catch (err) {
    // Logged so a broken read-back (an invalid API key, an outage) shows up on
    // /logs instead of silently turning every designed flyer into the fallback.
    logWarn("pipeline:read-image-text", err instanceof Error ? err.message : String(err), {
      draftId: opts.draftId,
    });
    return null;
  }
}
