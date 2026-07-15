// Pure presentation mapping from an app_logs `source` string (the label
// lib/log.ts's logUsage/logImageUsage calls are made with, e.g. "email-copy",
// "redesign", "flyer-image") to the human category the /billing usage chart
// groups by. Deliberately has no dependency on server-only modules (no
// "server-only" import, no db types) so a client component can import it
// directly.

const CATEGORY_LABELS: Record<string, string> = {
  "email-copy": "Email generation",
  "email-copy-retry": "Email generation",
  "email-copy-length-retry": "Email generation",
  "email-qa": "Email generation",
  "blog-copy": "Blog generation",
  "blog-copy-retry": "Blog generation",
  "blog-copy-length-retry": "Blog generation",
  "flyer-copy": "Flyer generation",
  "flyer-copy-retry": "Flyer generation",
  "flyer-image": "Flyer generation",
  "flyer-image-regenerate": "Flyer generation",
  redesign: "Redesign",
  "adjust-style": "Style edits",
  "adjust-copy": "Copy edits",
  "rewrite-region": "Copy edits",
  "image-prompt": "Image generation",
  "image-render": "Image generation",
  "brand-identity": "Brand setup",
  "email-design-profile": "Brand setup",
  "reference-email-style": "Brand setup",
};

/** Falls back to a Title Case of the raw source for anything not in the map
 *  above, so a new/renamed source never renders as a raw kebab-case slug. */
function humanizeSource(source: string): string {
  return source
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export interface UsageBreakdownInput {
  source: string;
  count: number;
  estimatedUsd: number;
}

export interface UsageBucket {
  label: string;
  count: number;
  estimatedUsd: number;
}

/**
 * Groups raw per-source usage rows into human categories, sorted by spend
 * descending, capped to `maxRows` with the remainder folded into "Other" (a
 * bar chart with a dozen thin slivers is worse than a ranked handful plus a
 * catch-all).
 */
export function bucketUsage(rows: UsageBreakdownInput[], maxRows = 6): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();
  for (const row of rows) {
    const label = CATEGORY_LABELS[row.source] ?? humanizeSource(row.source);
    const existing = buckets.get(label) ?? { label, count: 0, estimatedUsd: 0 };
    existing.count += row.count;
    existing.estimatedUsd += row.estimatedUsd;
    buckets.set(label, existing);
  }

  // Round after summing, not per-row: repeated float addition drifts (0.3 +
  // 0.1 + 0.03 !== 0.43 in IEEE 754), and the source rows are already each
  // rounded once in getUsageBreakdown.
  for (const bucket of buckets.values()) {
    bucket.estimatedUsd = Number(bucket.estimatedUsd.toFixed(4));
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.estimatedUsd - a.estimatedUsd);
  if (sorted.length <= maxRows) return sorted;

  const top = sorted.slice(0, maxRows - 1);
  const rest = sorted.slice(maxRows - 1);
  const other = rest.reduce<UsageBucket>(
    (acc, r) => ({
      label: "Other",
      count: acc.count + r.count,
      estimatedUsd: acc.estimatedUsd + r.estimatedUsd,
    }),
    { label: "Other", count: 0, estimatedUsd: 0 },
  );
  other.estimatedUsd = Number(other.estimatedUsd.toFixed(4));
  return [...top, other];
}

const REASON_LABELS: Record<string, string> = {
  starter: "Starter grant",
  allowance_free: "Free monthly allowance",
  allowance_paid: "Pro monthly allowance",
  pack_purchase: "Credit pack purchase",
  usage: "AI usage",
  manual_adjustment: "Manual adjustment",
};

/** Friendly label for a credit_transactions.reason value, for the /billing
 *  transaction history table. Falls back to the raw value for a reason added
 *  to the DB check constraint but not yet given a label here. */
export function humanizeReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}
