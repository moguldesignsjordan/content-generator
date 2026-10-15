import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import { getAverageDraftCostByKind } from "@/lib/db/queries";
import type {
  Brand,
  BrandMemory,
  FactoryKind,
  FactoryPlanItem,
  FactoryQuote,
  FactoryResearch,
  Icp,
  Product,
} from "@/lib/db/types";
import {
  RESEARCH_TOOLS,
  SAVE_RESEARCH_TOOL,
  buildResearchMessages,
  parseResearch,
} from "@/prompts/campaign-research";
import { SAVE_PLAN_TOOL, buildPlanMessages } from "@/prompts/campaign-plan";
import { FACTORY_KINDS, splitEvenly } from "@/prompts/campaign-formats";
import {
  addDays,
  assignDates,
  cleanPlanItems,
  pickTestItems,
  sumPlanUsd,
  type RawPlanItem,
} from "@/lib/factory/plan";
import { priceUsage } from "./cost";
import { creditsForUsage, getBillingConfig } from "@/lib/billing/credits";
import { logWarn } from "@/lib/log";

// The campaign factory's planning half: research, plan, quote. Nothing here
// generates content; the plan table is the human checkpoint before any piece
// is written, the same way the content-factory skill gates every batch.

export interface FactoryBrandContext {
  brand: Brand;
  primaryIcp: Icp | null;
  products: Product[];
  memories: BrandMemory[];
}

/** What each piece costs when the brand has no history for that kind yet, on
 * the default image model (Nano Banana 2.1). Email/blog: draft + QA + a 1K
 * hero. Social/ad: Haiku copy + 4 options at 2K. Rough on purpose; real
 * history (which also reflects a pricier model choice) replaces them after a
 * few drafts. */
export const DEFAULT_UNIT_USD: Record<FactoryKind, number> = {
  email: 0.25,
  blog: 0.25,
  social: 0.22,
  ad: 0.22,
};

/** At most this many pause_turn resumes before giving up on the research turn. */
const MAX_RESEARCH_ROUNDS = 4;

/**
 * Every URL the server tools actually returned in a response. Dynamic
 * filtering can surface search results through code execution output rather
 * than web_search_tool_result blocks, so citations and code output are read
 * too; anything not seen here can't be cited in the brief.
 */
export function collectSources(content: Anthropic.ContentBlock[]): { url: string; title: string }[] {
  const found = new Map<string, string>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    if (!found.has(url) || (!found.get(url) && typeof title === "string")) {
      found.set(url, typeof title === "string" ? title : "");
    }
  };
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) add(r.url, r.title);
    } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
      add(block.content.url, block.content.content.title);
    } else if (block.type === "text" && block.citations) {
      for (const c of block.citations) {
        const cite = c as { url?: unknown; title?: unknown };
        add(cite.url, cite.title);
      }
    } else if (block.type === "bash_code_execution_tool_result") {
      const stdout = (block.content as { stdout?: unknown }).stdout;
      if (typeof stdout === "string") {
        for (const url of stdout.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []) add(url);
      }
    }
  }
  return [...found].map(([url, title]) => ({ url, title }));
}

/** Stage 1: one Sonnet turn with web search + fetch, ending in save_research. */
export async function researchCampaign(
  ctx: FactoryBrandContext,
  args: { sentence: string; kinds: FactoryKind[]; today: string },
): Promise<{ research: FactoryResearch; usd: number }> {
  const { system, user } = buildResearchMessages({
    ...ctx,
    sentence: args.sentence,
    kinds: args.kinds,
    today: args.today,
  });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const sources: { url: string; title: string }[] = [];
  let usd = 0;

  const call = (forceSave: boolean) =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: cacheableSystem(system),
        messages,
        tools: [...RESEARCH_TOOLS, SAVE_RESEARCH_TOOL],
        tool_choice: forceSave
          ? { type: "tool", name: SAVE_RESEARCH_TOOL.name }
          : { type: "auto" },
      })
      .finalMessage();

  let forceSave = false;
  for (let round = 0; round < MAX_RESEARCH_ROUNDS; round++) {
    // The last round always forces the save, so a turn that kept pausing
    // still returns a brief from what it already found.
    const resp = await call(forceSave || round === MAX_RESEARCH_ROUNDS - 1);
    logUsage("factory-research", DRAFT_MODEL, resp.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: resp.id,
    });
    usd += priceUsage(DRAFT_MODEL, resp.usage);
    sources.push(...collectSources(resp.content));

    const save = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SAVE_RESEARCH_TOOL.name,
    );
    if (save) {
      return {
        research: parseResearch(save.input, {
          knownSources: sources,
          brandWebsite: ctx.brand.visual_identity?.footer?.website,
        }),
        usd,
      };
    }

    // pause_turn: resend as-is and the server resumes the search loop.
    messages.push({ role: "assistant", content: resp.content });
    if (resp.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Now call save_research with what you found." });
      forceSave = true;
    }
  }
  throw new Error("Research didn't finish. Try again.");
}

/** Stage 2: one forced save_campaign_plan call, then code-side cleanup. */
export async function planCampaign(
  ctx: FactoryBrandContext,
  args: {
    sentence: string;
    /** Absent when the owner chose to skip web research. */
    research?: FactoryResearch;
    kinds: FactoryKind[];
    size: number;
    days: number;
    startDate: string;
  },
): Promise<{ plan: FactoryPlanItem[]; usd: number }> {
  const counts = splitEvenly(args.size, args.kinds);
  const { system, user } = buildPlanMessages({
    ...ctx,
    sentence: args.sentence,
    research: args.research,
    counts,
  });

  const resp = await getAnthropic()
    .messages.stream({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [SAVE_PLAN_TOOL],
      tool_choice: { type: "tool", name: SAVE_PLAN_TOOL.name },
    })
    .finalMessage();
  logUsage("factory-plan", DRAFT_MODEL, resp.usage, {
    brandId: ctx.brand.id,
    metered: true,
    requestId: resp.id,
  });
  const usd = priceUsage(DRAFT_MODEL, resp.usage);

  const tu = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SAVE_PLAN_TOOL.name,
  );
  const rawItems = ((tu?.input as { items?: RawPlanItem[] } | undefined)?.items ?? []);
  const cleaned = cleanPlanItems(rawItems, {
    counts,
    productSlugs: new Set(ctx.products.map((p) => p.slug)),
    newId: () => crypto.randomUUID(),
  });
  if (!cleaned.length) throw new Error("The plan came back empty. Try again.");
  if (cleaned.length < args.size) {
    logWarn(
      "pipeline:campaign-factory:short-plan",
      `planned ${cleaned.length} of ${args.size} pieces after cleanup`,
      { brandId: ctx.brand.id },
    );
  }
  return { plan: assignDates(cleaned, args.startDate, args.days), usd };
}

/** Per-kind unit costs: this brand's real averages where it has history. */
export async function loadUnitCosts(brandId: string): Promise<{
  unit_usd: Record<FactoryKind, number>;
  from_history: Record<FactoryKind, boolean>;
}> {
  const history = await getAverageDraftCostByKind(brandId).catch(() => ({}) as Partial<
    Record<FactoryKind, number>
  >);
  const unit_usd = { ...DEFAULT_UNIT_USD };
  const from_history: Record<FactoryKind, boolean> = { social: false, ad: false, email: false, blog: false };
  for (const kind of FACTORY_KINDS) {
    const avg = history[kind];
    if (typeof avg === "number" && avg > 0) {
      unit_usd[kind] = Number(avg.toFixed(4));
      from_history[kind] = true;
    }
  }
  return { unit_usd, from_history };
}

/** Prices the unlaunched part of the plan, both as a whole and as the test-3 batch. */
export async function quotePlan(
  plan: FactoryPlanItem[],
  units: { unit_usd: Record<FactoryKind, number>; from_history: Record<FactoryKind, boolean> },
): Promise<FactoryQuote> {
  const config = await getBillingConfig();
  const pending = plan.filter((i) => !i.draft_id);
  const test = pickTestItems(plan);
  const price = (items: FactoryPlanItem[]) => {
    const usd = sumPlanUsd(items, units.unit_usd);
    return { usd, credits: items.length ? creditsForUsage(usd, config) : 0, count: items.length };
  };
  return { ...units, all: price(pending), test: price(test) };
}

/** Planning starts two days out so there's time to review before the first post. */
export function factoryStartDate(now = new Date()): string {
  return addDays(now.toISOString().slice(0, 10), 2);
}
