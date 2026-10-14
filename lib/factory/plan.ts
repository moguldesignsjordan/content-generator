import type { FactoryKind, FactoryPlanItem } from "@/lib/db/types";
import {
  FACTORY_KINDS,
  formatsForKind,
  getCampaignFormat,
} from "@/prompts/campaign-formats";
import { stripEmDashes } from "@/lib/text";

// Pure plan-table logic for the campaign factory: validate what the planning
// model returned, spread the pieces over the date range, and pick the
// "test 3 first" batch. No DB, no network, so it's unit-tested directly and
// safe to import from client components.

/** The shape the save_campaign_plan tool asks for; every field is untrusted. */
export interface RawPlanItem {
  kind?: unknown;
  format?: unknown;
  title?: unknown;
  hook?: unknown;
  core_idea?: unknown;
  key_message?: unknown;
  visual?: unknown;
  preview?: unknown;
  cta?: unknown;
  inspired_by?: unknown;
  needs_detail?: unknown;
  detail_prompt?: unknown;
  offer_slug?: unknown;
}

function text(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  return stripEmDashes(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isKind(value: unknown): value is FactoryKind {
  return typeof value === "string" && (FACTORY_KINDS as string[]).includes(value);
}

/** "YYYY-MM-DD" plus `days`, in UTC so a server near midnight can't drift. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Turns the planning model's raw items into plan rows: drops anything without
 * a title or hook, caps each kind at its planned count, forces each format to
 * belong to its kind, rejects a repeated hook or core idea (the "same angle
 * every time" problem), strips em dashes, and keeps offer_slug only when it
 * names a real product. Dates are assigned afterwards by assignDates.
 */
export function cleanPlanItems(
  raw: RawPlanItem[],
  opts: {
    counts: Record<FactoryKind, number>;
    productSlugs: Set<string>;
    newId: () => string;
  },
): Omit<FactoryPlanItem, "date">[] {
  const remaining = { ...opts.counts };
  const seenHooks = new Set<string>();
  const seenIdeas = new Set<string>();
  const formatTurn: Record<FactoryKind, number> = { social: 0, ad: 0, email: 0, blog: 0 };
  const out: Omit<FactoryPlanItem, "date">[] = [];

  for (const item of raw) {
    if (!isKind(item.kind) || remaining[item.kind] <= 0) continue;
    const kind = item.kind;
    const title = text(item.title, 160);
    const hook = text(item.hook, 240);
    if (!title || !hook) continue;

    const coreIdea = text(item.core_idea, 300);
    const hookKey = normalize(hook);
    const ideaKey = normalize(coreIdea);
    if (seenHooks.has(hookKey) || (ideaKey && seenIdeas.has(ideaKey))) continue;
    seenHooks.add(hookKey);
    if (ideaKey) seenIdeas.add(ideaKey);

    // A format from another kind (or an invented one) is replaced by the
    // kind's formats in rotation, so the row still has a real format.
    const requested = typeof item.format === "string" ? getCampaignFormat(item.format) : undefined;
    const kindFormats = formatsForKind(kind);
    const format =
      requested && requested.kind === kind
        ? requested.id
        : kindFormats[formatTurn[kind]++ % kindFormats.length].id;

    const slug = text(item.offer_slug, 120);
    const visual = text(item.visual, 400);
    const cta = text(item.cta, 80);
    const inspiredBy = text(item.inspired_by, 500);
    const needsDetail = item.needs_detail === true;
    const detailPrompt = needsDetail ? text(item.detail_prompt, 200) : "";

    out.push({
      id: opts.newId(),
      kind,
      format,
      title,
      hook,
      core_idea: coreIdea,
      key_message: text(item.key_message, 400),
      ...(visual ? { visual } : {}),
      preview: text(item.preview, 200),
      ...(cta ? { cta } : {}),
      ...(inspiredBy ? { inspired_by: inspiredBy } : {}),
      needs_detail: needsDetail,
      ...(detailPrompt ? { detail_prompt: detailPrompt } : {}),
      ...(slug && opts.productSlugs.has(slug) ? { offer_slug: slug } : {}),
    });
    remaining[kind]--;
  }
  return out;
}

/**
 * Spreads the pieces evenly over `days` starting at `startDate`, alternating
 * kinds day to day (round-robin across kinds, in each kind's own order).
 * Returns the rows in posting order.
 */
export function assignDates(
  items: Omit<FactoryPlanItem, "date">[],
  startDate: string,
  days: number,
): FactoryPlanItem[] {
  const queues = FACTORY_KINDS.map((kind) => items.filter((i) => i.kind === kind));
  const ordered: Omit<FactoryPlanItem, "date">[] = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) ordered.push(next);
    }
  }
  const span = Math.max(1, days);
  return ordered.map((item, i) => ({
    ...item,
    date: addDays(startDate, Math.floor((i * span) / Math.max(1, ordered.length))),
  }));
}

/** The "test 3 first" batch: the first unlaunched piece of up to three
 * different kinds, so one test shows how each kind turns out. */
export function pickTestItems(plan: FactoryPlanItem[]): FactoryPlanItem[] {
  const picked: FactoryPlanItem[] = [];
  for (const kind of FACTORY_KINDS) {
    const item = plan.find((i) => i.kind === kind && !i.draft_id);
    if (item) picked.push(item);
    if (picked.length === 3) break;
  }
  return picked;
}

/** Estimated USD for a set of pieces at the quote's per-kind unit costs. */
export function sumPlanUsd(
  items: Pick<FactoryPlanItem, "kind">[],
  unitUsd: Record<FactoryKind, number>,
): number {
  const total = items.reduce((sum, i) => sum + (unitUsd[i.kind] ?? 0), 0);
  return Number(total.toFixed(4));
}
