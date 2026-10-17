// The error module alone, not the SDK entry: lib/log.ts imports this file and
// instrumentation.ts bundles log.ts for the edge runtime too, where the full
// client's node:path import fails the build. Same class the client throws.
import { APIError as AnthropicAPIError } from "@anthropic-ai/sdk/core/error";

// ─────────────────────────────────────────────────────────────────────────────
// Tells "our AI provider account is broken" (billing, prepaid credits, a bad
// key) apart from every other failure. The difference matters twice: a client
// must never see our provider's billing details, and it's the one failure a
// retry can't fix, so it needs to reach Jordan (lib/provider-outage.ts).
//
// Error shapes checked against the live docs (2026-10):
//   Anthropic  402 billing_error, 401 authentication_error, 403
//              permission_error; a spend limit returns 400 instead.
//   OpenAI     401 bad key; 429 with code credit_balance_exhausted,
//              insufficient_quota, or *_spend_limit_exceeded /
//              organization_usage_limit_exceeded. A plain 429 is a rate limit.
//   Gemini     402 for billing/prepaid credits; 400 FAILED_PRECONDITION when
//              billing isn't enabled; 400 "API key not valid"; 403
//              PERMISSION_DENIED.
// Pure (no server-only) so it can be unit-tested directly.
// ─────────────────────────────────────────────────────────────────────────────

export type AiProvider = "anthropic" | "gemini" | "openai";
export type OutageKind = "billing" | "auth";

export interface ProviderOutage {
  provider: AiProvider;
  kind: OutageKind;
  status: number | null;
  /** The provider's own message, for the alert email and /logs only. */
  detail: string;
}

/** A failed call to a provider we reach without a typed SDK error (Gemini's
 *  interactions API, OpenAI over fetch), tagged so it can be classified. */
export class ProviderHttpError extends Error {
  readonly provider: AiProvider;
  readonly status: number | null;
  readonly code?: string;

  constructor(
    message: string,
    provider: AiProvider,
    status: number | null,
    code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

/** An error's HTTP status: its `status` field, or the leading code the Gemini
 *  SDK puts in its message ("402 ..."). */
export function httpStatusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  const match = err instanceof Error ? /^(\d{3})\b/.exec(err.message) : null;
  return match ? Number(match[1]) : null;
}

const OPENAI_BILLING_CODES = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

function classifyAnthropic(err: AnthropicAPIError): OutageKind | null {
  if (err.status === 402 || err.type === "billing_error") return "billing";
  if (err.status === 401 || err.status === 403) return "auth";
  if (err.status === 400 && /credit balance is too low|spend limit/i.test(err.message)) {
    return "billing";
  }
  return null;
}

function classifyTagged(err: ProviderHttpError): OutageKind | null {
  const { provider, status, code, message } = err;
  if (provider === "openai") {
    if (status === 401) return "auth";
    if (status === 429 && code && OPENAI_BILLING_CODES.has(code)) return "billing";
    return null;
  }
  if (provider === "gemini") {
    if (status === 402) return "billing";
    if (status === 400 && /FAILED_PRECONDITION/.test(message) && /billing/i.test(message)) {
      return "billing";
    }
    if (status === 401 || status === 403) return "auth";
    if (status === 400 && /API key not valid/i.test(message)) return "auth";
  }
  return null;
}

/** Walks the error and its `cause` chain (pipelines often rewrap) looking for a
 *  provider billing or auth failure. Null for anything else, including rate
 *  limits and overloads, which the SDK retries already ride out. */
export function detectProviderOutage(err: unknown): ProviderOutage | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof AnthropicAPIError) {
      const kind = classifyAnthropic(current);
      if (kind) {
        return { provider: "anthropic", kind, status: current.status ?? null, detail: current.message };
      }
    } else if (current instanceof ProviderHttpError) {
      const kind = classifyTagged(current);
      if (kind) {
        return { provider: current.provider, kind, status: current.status, detail: current.message };
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

/** What the client sees instead of the provider's message. */
export function outageMessage(outage: ProviderOutage): string {
  const feature = outage.provider === "anthropic" ? "AI writing" : "Image generation";
  return `${feature} is temporarily unavailable. We've been notified and are fixing it, so try again a little later.`;
}
