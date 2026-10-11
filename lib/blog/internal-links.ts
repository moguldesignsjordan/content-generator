// Picks the internal links a new piece should work in: posts already live on
// the site from the same cluster first (the hub-and-spoke siblings), then the
// rest of the pillar. Pure so it can be unit-tested away from the DB.

export interface LinkCandidate {
  id: string;
  title: string;
  cluster_id: string;
  published_url: string | null;
}

export const MAX_INTERNAL_LINKS = 5;

/** The brand website's host, without www, or null when none is set. */
function siteHost(website: string | null | undefined): string | null {
  const site = website?.trim();
  if (!site) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * True only for a page on the brand's own site. published_url also holds
 * MailerLite dashboard links (emails) and, on older blog topics, the Sanity
 * manage URL; neither belongs in an article.
 */
function isOnSite(url: string | null, host: string): url is string {
  if (!url) return false;
  try {
    return new URL(url).hostname.replace(/^www\./, "") === host;
  } catch {
    return false;
  }
}

export function buildInternalLinkTargets(
  topic: { id: string; cluster_id: string; internal_link_targets: string[] | null },
  candidates: LinkCandidate[],
  website: string | null | undefined,
): string[] {
  const stored = topic.internal_link_targets ?? [];
  const host = siteHost(website);
  if (!host) return stored;
  const seen = new Set(stored);
  const live = candidates.filter(
    (c) => c.id !== topic.id && isOnSite(c.published_url, host),
  );
  const ordered = [
    ...live.filter((c) => c.cluster_id === topic.cluster_id),
    ...live.filter((c) => c.cluster_id !== topic.cluster_id),
  ];

  const out = [...stored];
  for (const c of ordered) {
    if (out.length >= MAX_INTERNAL_LINKS) break;
    if (stored.some((s) => s.includes(c.published_url as string))) continue;
    const line = `${c.title}: ${c.published_url}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}
