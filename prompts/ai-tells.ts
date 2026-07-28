/**
 * The patterns that mark copy as AI-written, in one place.
 *
 * Both halves of the loop read this list: the writer is told to avoid them
 * (COPY PRINCIPLES in generate-email.ts / generate-blog.ts) and the QA
 * reviewer is told to catch them (qa-email.ts). Keeping one source means a
 * tell added here is enforced, not just discouraged, which is the whole point
 * of the QA revise pass: before it, these rules were advice nothing checked.
 */

/** The writer-facing form: prescriptive, nested under a COPY PRINCIPLES bullet. */
export const AI_TELL_WRITER_RULES: string[] = [
  "- AVOID THE TELLS THAT MARK COPY AS AI-WRITTEN:",
  "  - No 'It's not just X, it's Y' (or 'This isn't about X, it's about Y') constructions.",
  "  - No stacking three short punchy sentences in a row as a rhythm crutch",
  "    ('X. Y. Z.'); vary sentence length so short lines land because they're",
  "    earned, not because they're a pattern.",
  "  - No opening on a rhetorical question ('Ever wonder why...', 'What if I",
  "    told you...') or a scene-setting 'Picture this' / 'Imagine' lead-in.",
  "  - No throat-clearing openers ('In today's fast-paced world', 'Let's face",
  "    it', 'We get it'); start on the actual point.",
  "  - Use contractions naturally (it's, you're, don't); a sentence fragment",
  "    here and there reads more human than a fully grammatical one.",
  "  - One genuinely specific, concrete detail beats three vague superlatives;",
  "    if a line could open literally any brand's email, cut or sharpen it.",
];

/**
 * The auditor-facing form: only the patterns a reviewer can point at in the
 * text. The writer rules above include two positive instructions (use
 * contractions, prefer one concrete detail) that are style guidance, not
 * detectable defects, so they are deliberately absent here. Flagging those
 * would fail nearly every draft and burn the one revision on taste.
 */
export const AI_TELL_AUDIT_RULES: string[] = [
  "AI TELLS (flag any of these, quoted verbatim, in ai_tells_found):",
  "  - 'It's not just X, it's Y' / 'This isn't about X, it's about Y' constructions.",
  "  - Three short punchy sentences stacked in a row as a rhythm crutch ('X. Y. Z.').",
  "  - Opening on a rhetorical question ('Ever wonder why...', 'What if I told",
  "    you...') or a 'Picture this' / 'Imagine' scene-setting lead-in.",
  "  - Throat-clearing openers ('In today's fast-paced world', 'Let's face it',",
  "    'We get it') instead of starting on the point.",
  "  - An opening line so generic it could open literally any brand's email.",
  "Flag only real structural or verbatim matches. Do NOT flag copy merely for",
  "being plain, short, or not to your taste: a false positive here costs the",
  "draft a full rewrite it did not need.",
];
