// Model id constants, isolated from lib/clients/anthropic.ts (which re-exports
// them) so lib/pipeline/cost.ts can import them without creating a cycle
// through lib/log.ts (log.ts -> cost.ts for pricing, anthropic.ts -> log.ts
// for persistence).

/** Model used for generating email/blog drafts. */
export const DRAFT_MODEL = "claude-sonnet-4-6";

/**
 * Cheapest/fastest tier, for small structured-output calls where quality
 * needn't scale with cost: picking from a curated list, short classification,
 * a brand-identity palette. Don't use for anything drafting reader-facing copy.
 */
export const FAST_MODEL = "claude-haiku-4-5-20251001";
