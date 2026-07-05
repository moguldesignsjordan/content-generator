import "server-only";
import type {
  Brand,
  BrandIntegration,
  ContentJobType,
  DraftMeta,
  EmailDraftContent,
} from "@/lib/db/types";

// The publishing abstraction: every destination (MailerLite, Sanity, and
// whatever comes later, Klaviyo, ConvertKit, Beehiiv, social) is an adapter
// behind this interface. Adding a platform is one new file in ./providers plus
// one registry line; the pipeline (lib/pipeline/publish.ts) stays untouched.
// This mirrors the repo's "strategy is data" philosophy: destinations are
// config, not code paths.

/**
 * One connection field a user can set in Settings → Connections. The provider's
 * `fields` array is the single source of truth shared by the Connections form
 * and the connections API route (no separate field-schema metaprogramming).
 */
export interface ProviderField {
  /** Key in brand_integrations.config (and the form payload). */
  key: string;
  /** Form label. */
  label: string;
  /** Help text under the field. */
  hint?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Masked in the UI and encrypted at rest; never returned decrypted. */
  secret?: boolean;
  /** A string[] field rendered with the list editor (e.g. group IDs). */
  list?: boolean;
  /** Non-required fields can be left blank. */
  optional?: boolean;
  /** The env var used as fallback when this field is unset. Shown as a hint. */
  envVar?: string;
}

export interface PublishInput {
  jobId: string;
  draftId: string;
  content: EmailDraftContent;
  meta: DraftMeta;
  brand: Brand;
  /** The brand's saved connection for this provider, if any (env is fallback). */
  integration: BrandIntegration | null;
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

export interface PublishProvider {
  /** Stable id, recorded as publications.target (e.g. "mailerlite"). */
  id: string;
  /** Which kind of draft this provider can publish. */
  kind: ContentJobType;
  /** Human name for the Connections settings surface. */
  label: string;
  /** The env vars (fallback) this provider needs; shown when not connected. */
  configHint: string;
  /** Connection fields this provider needs (the Connections form contract). */
  fields: ProviderField[];
  /**
   * True when credentials are present from EITHER the brand's connection OR
   * the env-var fallback. Never throws. Per-field env fallback is deliberate
   * graceful degradation (a connected provider with one blank secret still
   * works if the env var fills it).
   */
  isConfigured(brand: Brand, integration: BrandIntegration | null): boolean;
  /**
   * Pushes one approved draft to the destination. MUST be safe to retry:
   * either internally idempotent (deterministic external id) or tolerant of
   * the pipeline's publications-row check that runs before every call.
   */
  publish(input: PublishInput): Promise<PublishResult>;
}
