import "server-only";
import { HARD_MODEL, cacheableSystem, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import {
  DESIGN_CRITIQUE_TOOL,
  DesignCritiqueSchema,
  buildDesignCritiqueMessages,
} from "@/prompts/critique-design";
import { validateModelEmailHtml } from "@/lib/email/validate";
import { stripEmDashes } from "@/lib/text";
import { logError, logWarn } from "@/lib/log";
import { applyEdits } from "@/lib/email/patch";
import type { UsageDelta } from "./cost";

export interface DesignCritiqueResult {
  html: string;
  /** Applied edits, described in plain language, for the draft's meta. */
  applied: string[];
  verdict: string;
  usageDeltas: UsageDelta[];
}

/**
 * Runs one design critique over a freshly generated email and applies the
 * fixes it returns.
 *
 * Three deliberate safety properties, in order of how much they matter:
 *
 * 1. **Edits are patches, not a rewrite.** applyEdits refuses a `find` that
 *    matches zero times or ambiguously, so the model cannot touch anything
 *    outside the exact spans it names.
 * 2. **Nothing is applied unvalidated.** The patched document goes through the
 *    same validateModelEmailHtml gate as generated HTML; a failure returns the
 *    original untouched.
 * 3. **It is entirely optional.** Every failure path (call error, bad schema,
 *    unmatched find, invalid result) returns null and the caller keeps the
 *    email it already had.
 *
 * Skipped when the code template produced the HTML: that path is already a
 * known-good design, so there is nothing here worth spending a call on.
 */
export async function critiqueDesign(args: {
  html: string;
  designBrief: string;
  designSource: "model" | "template";
  brandId: string;
}): Promise<DesignCritiqueResult | null> {
  if (args.designSource === "template") return null;

  const usageDeltas: UsageDelta[] = [];
  try {
    const { system, user } = buildDesignCritiqueMessages(args.html, args.designBrief);
    const response = await getAnthropic().messages.create({
      model: HARD_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      // Spotting what's visually off in a wall of table markup is the hardest
      // reading task in the pipeline; it gets the same effort as the angle.
      output_config: { effort: "xhigh" },
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [DESIGN_CRITIQUE_TOOL],
      tool_choice: { type: "tool", name: "critique_design" },
    });
    logUsage("design-critique", HARD_MODEL, response.usage, {
      brandId: args.brandId,
      metered: true,
      requestId: response.id,
    });
    usageDeltas.push({ model: HARD_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "critique_design",
    );
    if (!tu || tu.type !== "tool_use") return null;

    const parsed = DesignCritiqueSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:critique-design:invalid", parsed.error, {
        issues: parsed.error.issues,
      });
      return null;
    }

    const { verdict, edits } = parsed.data;
    if (!edits.length) {
      // A clean verdict is a real result, not a failure: report it so the
      // usage is still counted and the reviewer can see the design was checked.
      return { html: args.html, applied: [], verdict, usageDeltas };
    }

    // Applied one at a time on purpose: applyEdits is all-or-nothing per call,
    // and one unmatched find shouldn't discard five good fixes alongside it.
    let html = args.html;
    const applied: string[] = [];
    for (const edit of edits) {
      const result = applyEdits(html, [{ find: edit.find, replace: edit.replace }]);
      if ("error" in result) {
        logWarn("pipeline:critique-design:skip-edit", result.error, {
          problem: edit.problem,
        });
        continue;
      }
      html = result.html;
      applied.push(edit.problem);
    }
    if (!applied.length) return { html: args.html, applied: [], verdict, usageDeltas };

    const validated = validateModelEmailHtml(stripEmDashes(html));
    if (!validated) {
      logWarn(
        "pipeline:critique-design:invalid-html",
        "critique produced HTML that failed validation; keeping the original",
        { brandId: args.brandId },
      );
      return { html: args.html, applied: [], verdict, usageDeltas };
    }

    return { html: validated, applied, verdict, usageDeltas };
  } catch (err) {
    logError("pipeline:critique-design", err, { brandId: args.brandId });
    return null;
  }
}
