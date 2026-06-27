import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only Anthropic client.
//
// `server-only` ensures the API key can never be bundled into client code
// (Guardrail #1). The key is read once from the environment.
//
// Model choice: the build docs specify "Sonnet for drafts, Opus for hard
// pieces" (plan §2, v1-guide §5). Email drafting is the Sonnet path.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;

/** Model used for generating email/blog drafts. */
export const DRAFT_MODEL = "claude-sonnet-4-6";

export function isAnthropicConfigured(): boolean {
  return Boolean(apiKey);
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local.");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}
