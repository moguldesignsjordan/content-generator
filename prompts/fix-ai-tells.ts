import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { EmailCopy } from "@/lib/db/types";
import { AI_TELL_AUDIT_RULES } from "./ai-tells";

// Sentence-level repair for the AI tells QA caught. Runs on FAST_MODEL instead
// of a full rewrite: the draft is otherwise approved-quality, so only the
// flagged sentences change, and the find/replace shape means nothing else can.

export const FixAiTellsSchema = z.object({
  edits: z.array(z.object({ find: z.string(), replace: z.string() })),
});

/** Forced tool the fixer must call to return its sentence replacements. */
export const FIX_AI_TELLS_TOOL: Anthropic.Tool = {
  name: "fix_ai_tells",
  description: "Return one replacement per flagged sentence.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            find: {
              type: "string",
              description:
                "The complete original sentence containing the flagged phrase, copied character for character from the copy.",
            },
            replace: {
              type: "string",
              description: "The rewritten sentence.",
            },
          },
          required: ["find", "replace"],
        },
      },
    },
    required: ["edits"],
  },
};

export function buildFixAiTellsMessages(
  copy: EmailCopy,
  tells: string[],
): { system: string; user: string } {
  const system = [
    "You are a copy editor fixing phrases that make marketing email copy read as",
    "AI-written. For each flagged phrase, rewrite ONLY the sentence that contains",
    "it. Everything else in the email stays exactly as it is.",
    "",
    "RULES FOR EACH REWRITE:",
    "- Keep the meaning, the voice, and roughly the same length.",
    "- Say the point directly. For 'not just X, it's Y', state Y plainly.",
    "- Add no new facts, numbers, names, or claims.",
    "- Plain text only: no markdown, no HTML, no em dashes.",
    "- find must be the whole original sentence, copied exactly, so it can be",
    "  located in the copy. Never paraphrase find.",
    "- The rewrite must not introduce any of these:",
    // The indented lines are the patterns; the rest is auditor instruction.
    ...AI_TELL_AUDIT_RULES.filter((l) => l.startsWith("  ")),
  ].join("\n");

  const bodyLines = copy.body_sections
    .map((s, i) =>
      s.heading
        ? `SECTION ${i + 1} HEADING: ${s.heading}\nSECTION ${i + 1} BODY: ${s.body}`
        : `SECTION ${i + 1} BODY: ${s.body}`,
    )
    .join("\n\n");

  const user = [
    "FLAGGED PHRASES:",
    ...tells.map((t) => `- ${t}`),
    "",
    "THE EMAIL COPY:",
    `SUBJECT: ${copy.subject}`,
    `PREHEADER: ${copy.preheader}`,
    `HEADLINE: ${copy.headline}`,
    "",
    bodyLines,
    "",
    `CTA TEXT: ${copy.cta_text}`,
    "",
    "Call the fix_ai_tells tool with one edit per flagged phrase.",
  ].join("\n");

  return { system, user };
}
