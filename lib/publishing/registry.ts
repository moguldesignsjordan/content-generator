import "server-only";
import type { ContentJobType } from "@/lib/db/types";
import type { PublishProvider } from "./provider";
import { mailerliteProvider } from "./providers/mailerlite";
import { sanityProvider } from "./providers/sanity";

// Adding a destination = one adapter file + one line here. The Connections
// settings surface and the publish pipeline both read this list, so a new
// provider appears everywhere with no other code change.
const PROVIDERS: PublishProvider[] = [mailerliteProvider, sanityProvider];

export function listProviders(): PublishProvider[] {
  return PROVIDERS;
}

export function getProvider(id: string): PublishProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Configured providers that can publish this kind of draft, in registry order. */
export function providersForKind(kind: ContentJobType): PublishProvider[] {
  return PROVIDERS.filter((p) => p.kind === kind);
}
