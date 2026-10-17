import { NextResponse } from "next/server";
import { DRAFT_MODEL, getAnthropic, isAnthropicConfigured, logUsage } from "@/lib/clients/anthropic";
import { checkDailyBudget, checkRateLimit } from "@/lib/ai-guard";
import {
  createTopic,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  listProducts,
  listTopics,
  updateOnboardingState,
} from "@/lib/db/queries";
import type { FunnelStage } from "@/lib/db/types";
import {
  SUGGEST_TOPICS_TOOL,
  buildSuggestTopicsMessages,
  type SuggestTopicsToolInput,
} from "@/prompts/suggest-topics";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 120;

const IDEA_COUNT = 3;
const FUNNEL_STAGES = new Set(["awareness", "consideration", "decision", "brand"]);

/**
 * POST: the three starter ideas on "You're set", saved as topics so "Make
 * it" opens Create on a real topic. Idempotent: once saved, the same three
 * come back on a reload instead of three more. Free to the owner.
 */
export async function POST() {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Set ANTHROPIC_API_KEY in .env.local." }, { status: 503 });
  }
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const data = await getBrandWithIcps(user.id);
    if (!data) return NextResponse.json({ error: "No brand found" }, { status: 404 });
    const { brand, icps } = data;
    const state = brand.onboarding_state ?? {};

    const existing = await listTopics(brand.id);
    const saved = existing.filter((t) => state.idea_topic_ids?.includes(t.id));
    if (saved.length) return NextResponse.json({ ideas: saved.map(({ id, title }) => ({ id, title })) });

    const limited = checkRateLimit(`onboarding-ideas:${brand.id}`, 3, 10 * 60_000);
    if (!limited.ok) return NextResponse.json({ error: limited.error }, { status: limited.status });
    const budget = await checkDailyBudget();
    if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: budget.status });

    const { strategy } = await ensureStrategyAndPrimaryIcp(brand.id);
    const products = await listProducts(brand.id);
    const { system, user: userMessage } = buildSuggestTopicsMessages({
      brand,
      strategy,
      primaryIcp: icps.find((i) => i.is_primary) ?? icps[0] ?? null,
      products,
      existingTitles: existing.map((t) => t.title),
    });
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userMessage }],
      tools: [SUGGEST_TOPICS_TOOL],
      tool_choice: { type: "tool", name: SUGGEST_TOPICS_TOOL.name },
    });
    logUsage("onboarding-ideas", DRAFT_MODEL, response.usage, { brandId: brand.id });

    const tu = response.content.find((b) => b.type === "tool_use" && b.name === SUGGEST_TOPICS_TOOL.name);
    const raw = (tu?.type === "tool_use" ? tu.input : {}) as SuggestTopicsToolInput;
    const knownSlugs = new Set(products.map((p) => p.slug));
    const picks = (raw.topics ?? []).filter((t) => t.title?.trim()).slice(0, IDEA_COUNT);
    if (!picks.length) {
      return NextResponse.json({ error: "Couldn't come up with ideas. Try again." }, { status: 502 });
    }

    const clusterId = await ensureDefaultCluster(strategy.id);
    const ideas: { id: string; title: string }[] = [];
    for (const t of picks) {
      const topic = await createTopic(clusterId, {
        title: stripEmDashes(t.title!.trim()),
        target_keyword: t.target_keyword ?? "",
        intent: t.intent ?? "",
        funnel_stage: FUNNEL_STAGES.has(t.funnel_stage ?? "") ? (t.funnel_stage as FunnelStage) : "",
        maps_to_product: knownSlugs.has(t.maps_to_product ?? "") ? t.maps_to_product! : "",
      });
      ideas.push({ id: topic.id, title: topic.title });
    }
    await updateOnboardingState(brand.id, { ...state, idea_topic_ids: ideas.map((i) => i.id) });
    return NextResponse.json({ ideas });
  } catch (err) {
    logError("api:/api/onboarding/ideas", err);
    return NextResponse.json({ error: "Couldn't come up with ideas. Try again." }, { status: 500 });
  }
}
