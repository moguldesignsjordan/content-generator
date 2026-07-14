import { NextRequest, NextResponse } from "next/server";
import {
  DRAFT_MODEL,
  getAnthropic,
  isAnthropicConfigured,
  logUsage,
} from "@/lib/clients/anthropic";
import {
  createTopic,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  listProducts,
  listTopics,
} from "@/lib/db/queries";
import {
  SUGGEST_TOPICS_TOOL,
  buildSuggestTopicsMessages,
  type SuggestTopicsToolInput,
  type TopicIdeaInput,
} from "@/prompts/suggest-topics";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 120;

const FUNNEL_STAGES = new Set(["awareness", "consideration", "decision", "brand"]);

/**
 * POST: propose 5-8 topic ideas from the brand brain. Never persists; the
 * client shows them with checkboxes and saves the picked ones via PUT.
 */
export async function POST() {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const data = await getBrandWithIcps(sessionUser.id);
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand, strategy, icps } = data;
    const [products, existing] = await Promise.all([
      listProducts(brand.id),
      listTopics(),
    ]);

    const { system, user } = buildSuggestTopicsMessages({
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
      messages: [{ role: "user", content: user }],
      tools: [SUGGEST_TOPICS_TOOL],
      tool_choice: { type: "tool", name: "save_topic_ideas" },
    });
    logUsage("topics-suggest", DRAFT_MODEL, response.usage, {
      brandId: data.brand.id,
    });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_topic_ideas",
    );
    if (!tu || tu.type !== "tool_use") {
      return NextResponse.json(
        { error: "The model returned no ideas. Try again." },
        { status: 502 },
      );
    }

    const raw = tu.input as SuggestTopicsToolInput;
    const knownSlugs = new Set(products.map((p) => p.slug));
    const proposals = (raw.topics ?? [])
      .filter((t) => t.title?.trim())
      .map((t) => ({
        title: stripEmDashes(t.title!.trim()),
        target_keyword: t.target_keyword?.trim() || undefined,
        intent: t.intent?.trim() || undefined,
        funnel_stage: FUNNEL_STAGES.has(t.funnel_stage ?? "")
          ? t.funnel_stage
          : undefined,
        maps_to_product: knownSlugs.has(t.maps_to_product ?? "")
          ? t.maps_to_product
          : undefined,
      }));

    return NextResponse.json({ proposals });
  } catch (err) {
    logError("api:/api/topics/suggest:post", err);
    return NextResponse.json(
      { error: "Couldn't suggest topics. Try again." },
      { status: 500 },
    );
  }
}

/**
 * PUT: the explicit save. Adds the user-picked ideas to the content plan,
 * creating the starter pillar/cluster when the brand has none yet.
 */
export async function PUT(req: NextRequest) {
  try {
    const { topics } = (await req.json()) as { topics?: TopicIdeaInput[] };
    if (!topics?.length) {
      return NextResponse.json({ error: "No topics to add." }, { status: 400 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const data = await getBrandWithIcps(sessionUser.id);
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }

    const { strategy } = await ensureStrategyAndPrimaryIcp(data.brand.id);
    const clusterId = await ensureDefaultCluster(strategy.id);

    let created = 0;
    for (const t of topics) {
      if (!t.title?.trim()) continue;
      await createTopic(clusterId, {
        title: stripEmDashes(t.title.trim()),
        target_keyword: t.target_keyword ?? "",
        intent: t.intent ?? "",
        funnel_stage: FUNNEL_STAGES.has(t.funnel_stage ?? "")
          ? (t.funnel_stage as TopicIdeaInput["funnel_stage"])!
          : "",
        maps_to_product: t.maps_to_product ?? "",
      });
      created++;
    }
    return NextResponse.json({ created });
  } catch (err) {
    logError("api:/api/topics/suggest:put", err);
    return NextResponse.json(
      { error: "Couldn't add topics. Try again." },
      { status: 500 },
    );
  }
}
