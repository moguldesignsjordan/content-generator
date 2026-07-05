import "server-only";
import type {
  Brand,
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

export interface PublishInput {
  jobId: string;
  draftId: string;
  content: EmailDraftContent;
  meta: DraftMeta;
  brand: Brand;
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
  /** The env vars (v1) this provider needs; shown in Connections. */
  configHint: string;
  /** True when credentials are present. Never throws. */
  isConfigured(): boolean;
  /**
   * Pushes one approved draft to the destination. MUST be safe to retry:
   * either internally idempotent (deterministic external id) or tolerant of
   * the pipeline's publications-row check that runs before every call.
   */
  publish(input: PublishInput): Promise<PublishResult>;
}
