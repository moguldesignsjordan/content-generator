import "server-only";
import { FAST_MODEL, cacheableSystem, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import { getDraftWithJobContext, getTopicContext } from "@/lib/db/queries";
import { buildRewriteMessages, REWRITE_REGION_TOOL, type RewriteToolInput } from "@/prompts/rewrite-region";
import { stripEmDashes } from "@/lib/text";

// Proposes new wording for one section. COMMITS NOTHING.
//
// This is the whole point: the caller (the Rewrite modal) shows the proposal
// next to the current text and only writes it if the user accepts, at which
// point it goes in through the same deterministic text-placement path as
// hand-typed text. The model therefore never authors markup, which is what
// used to let a rewrite silently break the email's layout.
//
// Shared by email and blog — a section's words are a section's words, and the
// two review screens run the same component.

export type RewriteResult = { ok: true; text: string } | { ok: false; error: string };

export async function rewriteRegion(
  draftId: string,
  args: {
    label: string;
    currentText: string;
    instruction?: string;
    /** Blog bodies (and email body blocks) may carry light markdown; headlines may not. */
    allowMarkdown: boolean;
  },
): Promise<RewriteResult> {
  const { label, currentText, instruction, allowMarkdown } = args;

  if (!currentText.trim()) {
    return { ok: false, error: "There's no text in that section to rewrite." };
  }

  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) return { ok: false, error: "Topic not found for this draft." };

  const channel = draftCtx.jobType === "blog" ? "blog" : "email";
  const { system, user } = buildRewriteMessages({
    brand: ctx.brand,
    icp: ctx.primaryIcp,
    channel,
    label,
    currentText,
    instruction,
    allowMarkdown,
  });

  try {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 2048,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [REWRITE_REGION_TOOL],
      tool_choice: { type: "tool", name: "save_rewritten_text" },
    });
    logUsage("rewrite-region", FAST_MODEL, response.usage, { draftId });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_rewritten_text",
    );
    if (!tu || tu.type !== "tool_use") {
      return { ok: false, error: "The model returned nothing. Try again." };
    }
    const text = (tu.input as RewriteToolInput).text?.trim();
    if (!text) return { ok: false, error: "The model didn't write anything. Try again." };

    // The em-dash ban is a house rule, enforced here rather than trusted to the
    // prompt — same as every other model output in the pipeline.
    return { ok: true, text: stripEmDashes(text) };
  } catch {
    return { ok: false, error: "Couldn't reach the writer. Try again." };
  }
}
