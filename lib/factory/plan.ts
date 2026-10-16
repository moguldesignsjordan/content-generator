import {
  MAX_PHOTOS_PER_DESIGN,
  type FactoryKind,
  type FactoryPlanItem,
  type FactoryState,
  type Product,
} from "@/lib/db/types";
import { inputsOf } from "@/lib/inputs";
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
  uses_reference?: unknown;
  photos?: unknown;
  product?: unknown;
}

/** The most pieces one campaign plans. */
export const MAX_CAMPAIGN_SIZE = 20;

/** How many pieces of each kind one product gets in a one-per-product plan. */
export interface ProductSlot {
  product: string;
  total: number;
  kinds: Record<FactoryKind, number>;
}

const noKinds = (): Record<FactoryKind, number> => ({ social: 0, ad: 0, email: 0, blog: 0 });

/**
 * The exact pieces per product: `perProduct` each, capped at
 * MAX_CAMPAIGN_SIZE in all (spread evenly, earlier products first), with
 * kinds rotating across the whole plan so each product gets a mix.
 */
export function planProductSlots(
  products: string[],
  perProduct: number,
  kinds: FactoryKind[],
): ProductSlot[] {
  if (!products.length || !kinds.length || perProduct <= 0) return [];
  const total = Math.min(MAX_CAMPAIGN_SIZE, products.length * perProduct);
  const base = Math.floor(total / products.length);
  let remainder = total - base * products.length;
  let turn = 0;
  return products
    .map((product) => {
      const count = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      const slot: ProductSlot = { product, total: count, kinds: noKinds() };
      for (let i = 0; i < count; i++) slot.kinds[kinds[turn++ % kinds.length]]++;
      return slot;
    })
    .filter((slot) => slot.total > 0);
}

/** Per-kind totals across product slots. */
export function slotCounts(slots: ProductSlot[]): Record<FactoryKind, number> {
  const counts = noKinds();
  for (const slot of slots) for (const kind of FACTORY_KINDS) counts[kind] += slot.kinds[kind];
  return counts;
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
 * names a real product. In a one-per-product plan every row must name a
 * listed product, each product is capped at its count, and a saved product's
 * slug becomes the row's offer. Dates are assigned afterwards by assignDates.
 */
export function cleanPlanItems(
  raw: RawPlanItem[],
  opts: {
    counts: Record<FactoryKind, number>;
    productSlugs: Set<string>;
    newId: () => string;
    /** The owner's product photos; an item's `photos` are 1-based indexes into these. */
    photoUrls?: string[];
    /** One design per product: each row names one of these, `max` per product. */
    products?: { name: string; slug?: string; max: number }[];
  },
): Omit<FactoryPlanItem, "date">[] {
  const remaining = { ...opts.counts };
  const perProduct = new Map((opts.products ?? []).map((p) => [normalize(p.name), { ...p }]));
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
    const product = perProduct.size ? perProduct.get(normalize(text(item.product, 120))) : undefined;
    if (perProduct.size && (!product || product.max <= 0)) continue;

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
    const photos = Array.from(
      new Set(
        (Array.isArray(item.photos) ? item.photos : [])
          .filter((n): n is number => typeof n === "number" && Number.isInteger(n))
          .map((n) => opts.photoUrls?.[n - 1])
          .filter((url): url is string => Boolean(url)),
      ),
    ).slice(0, MAX_PHOTOS_PER_DESIGN);

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
      ...(product?.slug && opts.productSlugs.has(product.slug)
        ? { offer_slug: product.slug }
        : slug && opts.productSlugs.has(slug)
          ? { offer_slug: slug }
          : {}),
      ...(product ? { product: product.name } : {}),
      ...(item.uses_reference === true ? { uses_reference: true } : {}),
      ...(photos.length ? { photos } : {}),
    });
    remaining[kind]--;
    if (product) product.max--;
  }
  return out;
}

/**
 * Spreads the pieces evenly over `days` starting at `startDate`, alternating
 * kinds day to day (round-robin across kinds, in each kind's own order), or
 * alternating products in a one-per-product plan. Returns the rows in
 * posting order.
 */
export function assignDates(
  items: Omit<FactoryPlanItem, "date">[],
  startDate: string,
  days: number,
): FactoryPlanItem[] {
  const products = Array.from(new Set(items.map((i) => i.product).filter(Boolean)));
  const queues = products.length
    ? products.map((product) => items.filter((i) => i.product === product))
    : FACTORY_KINDS.map((kind) => items.filter((i) => i.kind === kind));
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
 * different kinds, so one test shows how each kind turns out. In a
 * one-per-product plan, three different products first (different kinds
 * where possible). */
export function pickTestItems(plan: FactoryPlanItem[]): FactoryPlanItem[] {
  const pending = plan.filter((i) => !i.draft_id);
  if (pending.some((i) => i.product)) {
    const chosen: FactoryPlanItem[] = [];
    const passes: ((i: FactoryPlanItem) => boolean)[] = [
      (i) => !chosen.some((c) => c.product === i.product || c.kind === i.kind),
      (i) => !chosen.some((c) => c.product === i.product),
      (i) => !chosen.some((c) => c.kind === i.kind),
      () => true,
    ];
    for (const fits of passes) {
      for (const item of pending) {
        if (chosen.length === 3) return chosen;
        if (!chosen.includes(item) && fits(item)) chosen.push(item);
      }
    }
    return chosen;
  }
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

/**
 * A per-product plan's products that aren't saved yet, each with the photo
 * the owner gave for it (one of their own chat photos the planner put on
 * that product's pieces), so the plan can offer to save them in one tap.
 */
export function unsavedPlanProducts(
  factory: Pick<FactoryState, "products" | "plan" | "inputs">,
  saved: Pick<Product, "name" | "slug">[],
): { name: string; photo?: string }[] {
  const own = new Set(inputsOf(factory).photos ?? []);
  const known = new Set(saved.flatMap((p) => [normalize(p.name), normalize(p.slug)]));
  return (factory.products ?? [])
    .filter((p) => !p.slug && !known.has(normalize(p.name)))
    .map((p) => {
      const photo = (factory.plan ?? [])
        .filter((i) => i.product === p.name)
        .flatMap((i) => i.photos ?? [])
        .find((url) => own.has(url));
      return photo ? { name: p.name, photo } : { name: p.name };
    });
}
