import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import type { UsageDelta } from "./cost";
import { logWarn } from "@/lib/log";

const CHECK_TOOL: Anthropic.Tool = {
  name: "report_image_check",
  description: "Report whether the rendered image is fit to ship, and what is wrong if not.",
  input_schema: {
    type: "object",
    properties: {
      pass: {
        type: "boolean",
        description: "true unless the image has one of the listed defects.",
      },
      problems: {
        type: "array",
        items: { type: "string" },
        description:
          "Each defect in a few plain words, written as what to fix (e.g. 'garbled letters on the mug', 'the hand has six fingers'). Empty when pass is true.",
      },
    },
    required: ["pass", "problems"],
  },
};

export interface ImageCheck {
  pass: boolean;
  problems: string[];
}

/** The tool input as a checked result; null when the shape is unusable. */
export function parseImageCheck(input: unknown): ImageCheck | null {
  const raw = input as { pass?: unknown; problems?: unknown } | undefined;
  if (typeof raw?.pass !== "boolean") return null;
  const problems = Array.isArray(raw.problems)
    ? raw.problems.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
  // A fail with no named problem gives the re-render nothing to fix, so it
  // counts as a pass rather than spending a render on a guess.
  return { pass: raw.pass || problems.length === 0, problems: raw.pass ? [] : problems };
}

export function buildImageCheckPrompt(intended: string, allowProductText: boolean): string {
  return [
    "You are checking an AI-rendered marketing hero image before a person sees it.",
    "It was asked to show:",
    intended,
    "",
    "Fail it ONLY for these defects:",
    allowProductText
      ? "- Text, letters, or logos that are garbled or invented. Real printed text on the product itself is fine."
      : "- Any visible text, letters, numbers, logos, or watermarks (the image was meant to have none).",
    "- Malformed people or animals: wrong number of fingers or limbs, melted or distorted faces.",
    "- Objects that are visibly broken or merged in ways that look like an AI mistake.",
    "- The main subject asked for is missing or clearly something else.",
    "Do NOT fail it for taste, color, or style choices. When unsure, pass it.",
    "Call report_image_check.",
  ].join("\n");
}

/**
 * One Sonnet vision look at a rendered hero, so a garbled or off-brief render
 * gets one retry before anyone sees it. Returns null when the check itself
 * fails; the caller then keeps the render as-is (a broken check must never
 * cost an image).
 */
export async function checkHeroImage(
  image: { data: string; mimeType: string },
  opts: {
    intended: string;
    allowProductText: boolean;
    brandId?: string;
    draftId?: string;
    usage: UsageDelta[];
  },
): Promise<ImageCheck | null> {
  try {
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mimeType as "image/jpeg", data: image.data },
            },
            { type: "text", text: buildImageCheckPrompt(opts.intended, opts.allowProductText) },
          ],
        },
      ],
      tools: [CHECK_TOOL],
      tool_choice: { type: "tool", name: CHECK_TOOL.name },
    });
    logUsage("image-check", DRAFT_MODEL, response.usage, {
      brandId: opts.brandId,
      draftId: opts.draftId,
      metered: true,
      requestId: response.id,
    });
    opts.usage.push({ model: DRAFT_MODEL, ...response.usage });
    const tu = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === CHECK_TOOL.name,
    );
    return parseImageCheck(tu?.input);
  } catch (err) {
    logWarn("pipeline:check-image", err instanceof Error ? err.message : String(err), {
      draftId: opts.draftId,
    });
    return null;
  }
}
