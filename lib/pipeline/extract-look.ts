import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import { EXTRACT_LOOK_TOOL, buildExtractLookMessages, parseLookProfile } from "@/prompts/extract-look";
import type { DesignLookProfile, LookExample } from "@/lib/db/types";
import { prepareReferenceImage } from "@/lib/images/optimize";
import { logError, logWarn } from "@/lib/log";

/** Examples read per look; more adds cost without changing the pattern. */
export const MAX_LOOK_EXAMPLES = 6;

/** Downloads hosted example images as model input; unreadable ones are skipped. */
export async function loadLookImages(
  examples: LookExample[],
  limit = MAX_LOOK_EXAMPLES,
): Promise<{ data: string; mimeType: string }[]> {
  const loaded = await Promise.all(
    examples.slice(0, limit).map(async (ex) => {
      try {
        const res = await fetch(ex.url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        return await prepareReferenceImage(Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        logWarn("pipeline:extract-look:image", err instanceof Error ? err.message : String(err), {
          url: ex.url,
        });
        return null;
      }
    }),
  );
  return loaded.filter((x): x is { data: string; mimeType: string } => x !== null);
}

/**
 * Reads a look's examples once, at save time (the sibling of
 * extractEmailDesign). Non-fatal: null on any failure, and the look is still
 * saved, since the example images alone still guide every render.
 */
export async function extractLookProfile(
  examples: LookExample[],
  brandId: string,
): Promise<DesignLookProfile | null> {
  try {
    const images = await loadLookImages(examples);
    if (!images.length) return null;
    const { system, user } = buildExtractLookMessages(images.length);
    const content: Anthropic.ContentBlockParam[] = [
      ...images.map(
        (img): Anthropic.ContentBlockParam => ({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType as "image/jpeg" | "image/png" | "image/webp",
            data: img.data,
          },
        }),
      ),
      { type: "text", text: user },
    ];
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content }],
      tools: [EXTRACT_LOOK_TOOL],
      tool_choice: { type: "tool", name: EXTRACT_LOOK_TOOL.name },
    });
    logUsage("look-profile", DRAFT_MODEL, response.usage, { brandId, metered: true, requestId: response.id });
    const tu = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === EXTRACT_LOOK_TOOL.name,
    );
    const profile = tu ? parseLookProfile(tu.input) : null;
    if (!profile) logWarn("pipeline:extract-look:invalid", "look profile failed validation", { brandId });
    return profile;
  } catch (err) {
    logError("pipeline:extract-look", err, { brandId });
    return null;
  }
}
