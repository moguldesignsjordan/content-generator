// Model id constants, isolated from lib/clients/anthropic.ts (which re-exports
// them) so lib/pipeline/cost.ts can import them without creating a cycle
// through lib/log.ts (log.ts -> cost.ts for pricing, anthropic.ts -> log.ts
// for persistence).

/** Model used for generating email/blog drafts. */
export const DRAFT_MODEL = "claude-sonnet-5";

/**
 * The "Opus for hard pieces" tier the architecture always specified: reserved
 * for the judgment calls, not the volume work. Today that's the design
 * critique, which only runs when a brand opts into it (Settings, "Deep design
 * review"); drafting and angle selection stay on DRAFT_MODEL.
 */
export const HARD_MODEL = "claude-opus-5";

/**
 * Cheapest/fastest tier, for small structured-output calls where quality
 * needn't scale with cost: picking from a curated list, short classification,
 * a brand-identity palette. Don't use for anything drafting reader-facing copy.
 */
export const FAST_MODEL = "claude-haiku-4-5-20251001";
