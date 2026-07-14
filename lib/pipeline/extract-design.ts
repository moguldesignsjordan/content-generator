import "server-only";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import {
  EXTRACT_DESIGN_TOOL,
  EmailDesignProfileSchema,
  buildExtractDesignMessages,
} from "@/prompts/extract-design";
import type { EmailDesignProfile } from "@/lib/db/types";
import { logError } from "@/lib/log";

/**
 * Distills the DESIGN of one uploaded email screenshot, once, at upload time.
 * The visual twin of extractEmailStyle: same forced-tool, null-on-failure
 * shape, but the user turn carries the image.
 *
 * Non-fatal by design: a failed extraction returns null and the reference is
 * still saved. The raw image alone is enough to recreate a design from (it's
 * attached to every generation), so the notes are an accelerant, not a
 * prerequisite, and an upload never fails over a model hiccup.
 *
 * Takes the base64 payload from prepareReferenceImage (bounded to 1024px JPEG).
 */
export async function extractEmailDesign(image: {
  data: string;
  mimeType: string;
}): Promise<EmailDesignProfile | null> {
  try {
    const { system, user } = buildExtractDesignMessages();
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: image.data,
              },
            },
            { type: "text", text: user },
          ],
        },
      ],
      tools: [EXTRACT_DESIGN_TOOL],
      tool_choice: { type: "tool", name: "save_design_profile" },
    });
    logUsage("email-design-profile", DRAFT_MODEL, response.usage);

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_design_profile",
    );
    if (!tu || tu.type !== "tool_use") return null;
    const parsed = EmailDesignProfileSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:extract-design:invalid", parsed.error, {
        issues: parsed.error.issues,
      });
      return null;
    }
    return parsed.data;
  } catch (err) {
    logError("pipeline:extract-design", err);
    return null;
  }
}
