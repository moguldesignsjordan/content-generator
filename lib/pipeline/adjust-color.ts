import "server-only";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
} from "@/lib/clients/anthropic";
import { getDraftWithJobContext } from "@/lib/db/queries";
import {
  ADJUST_COLOR_TOOL,
  buildAdjustColorMessages,
  type AdjustColorRegionContext,
  type AdjustColorToolInput,
} from "@/prompts/adjust-color";
import { applyEdits, commitHtmlEdit } from "./html-edit";
import type { StyleEditHistoryEntry } from "@/lib/db/types";

// Single-shot COLOR edit for one region of an existing email draft: the user
// clicked a region and picked an exact hex color, no free-text ambiguity.
// Sibling to adjust-copy (words) and adjust-style (open-ended looks); same
// FAST_MODEL -> retry -> DRAFT_MODEL reliability ladder and the shared
// commitHtmlEdit tail (validate / sanitize / undo stack / persist).

export type AdjustColorResult =
  | {
      ok: true;
      html: string;
      history: StyleEditHistoryEntry[];
      caveat?: string;
    }
  | { ok: false; error: string };

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

async function attemptColorEdit(
  model: string,
  system: string,
  user: string,
  currentHtml: string,
): Promise<{ html: string; caveat?: string } | { error: string }> {
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 2048,
    system: cacheableSystem(system),
    messages: [{ role: "user", content: user }],
    tools: [ADJUST_COLOR_TOOL],
    tool_choice: { type: "tool", name: "save_color_patch" },
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_color_patch",
  );
  if (!tu || tu.type !== "tool_use") {
    return { error: "The model returned nothing." };
  }
  const raw = tu.input as AdjustColorToolInput;
  if (!raw.edits?.length) {
    return { error: "The model didn't describe any change." };
  }

  const result = applyEdits(currentHtml, raw.edits);
  if ("error" in result) return { error: result.error };
  return { html: result.html, caveat: raw.client_support_caveat };
}

export async function adjustColor(
  draftId: string,
  args: { regionCtx: AdjustColorRegionContext; hex: string },
): Promise<AdjustColorResult> {
  const { regionCtx, hex } = args;

  if (!HEX_RE.test(hex)) {
    return { ok: false, error: "Pick a valid color." };
  }

  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const { system, user } = buildAdjustColorMessages({
    currentHtml: draftCtx.content.html,
    hex,
    regionCtx,
  });

  // Same retry ladder as adjust-style/adjust-copy: Haiku is enough for a
  // scoped, exact-target color swap, but an exact-match find can miss on
  // sampling variance, so retry once on Haiku before escalating to Sonnet.
  let attempt = await attemptColorEdit(FAST_MODEL, system, user, draftCtx.content.html);
  if ("error" in attempt) {
    attempt = await attemptColorEdit(FAST_MODEL, system, user, draftCtx.content.html);
  }
  if ("error" in attempt) {
    attempt = await attemptColorEdit(DRAFT_MODEL, system, user, draftCtx.content.html);
  }
  if ("error" in attempt) {
    return { ok: false, error: `${attempt.error} Try again.` };
  }

  const result = await commitHtmlEdit({
    draftCtx,
    html: attempt.html,
    label: `Changed ${regionCtx.label.toLowerCase()} color to ${hex}`,
    type: "recolor",
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    html: result.html,
    history: result.history,
    caveat: attempt.caveat,
  };
}
