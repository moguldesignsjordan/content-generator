import { NextRequest, NextResponse } from "next/server";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  cacheableSystem,
  getAnthropic,
  withCacheBreakpoint,
} from "@/lib/clients/anthropic";
import {
  ensureStrategyAndPrimaryIcp,
  getBrandWithIcps,
  updateBrandBasics,
  updateBrandVoice,
  updateIcp,
  updateOnboardingState,
  updatePositioning,
} from "@/lib/db/queries";
import type {
  Brand,
  IcpProfile,
  OnboardingMessage,
  OnboardingState,
  Positioning,
  VoiceProfile,
} from "@/lib/db/types";
import {
  ONBOARDING_TOOL,
  buildOnboardingSystem,
  type OnboardingToolInput,
} from "@/prompts/onboarding";
import { stripEmDashes } from "@/lib/text";

export const maxDuration = 120;

/**
 * One onboarding chat turn. The model replies conversationally AND may call
 * `save_brand_profile` with extracted fields; we apply those to the DB and
 * persist the text transcript. Returns the reply and whether onboarding is done.
 */
export async function POST(req: NextRequest) {
  try {
    const { brandId, message } = (await req.json()) as {
      brandId?: string;
      message?: string;
    };
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand } = data;

    const state: OnboardingState = brand.onboarding_state ?? {};
    const history: OnboardingMessage[] = state.messages ?? [];

    const priorTurns: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (priorTurns.length > 0) {
      priorTurns[priorTurns.length - 1] = withCacheBreakpoint(
        priorTurns[priorTurns.length - 1],
      );
    }
    const messages = [
      ...priorTurns,
      { role: "user" as const, content: message.trim() },
    ];

    const system = cacheableSystem(buildOnboardingSystem(brand));

    // One retry on a transient API/parse failure so a flaky turn doesn't break
    // onboarding; reusing the same `system` array lets the retry hit cache.
    const call = () =>
      getAnthropic().messages.create({
        model: DRAFT_MODEL,
        max_tokens: 1024,
        system,
        messages,
        tools: [ONBOARDING_TOOL],
        tool_choice: { type: "auto" },
      });

    let response;
    try {
      response = await call();
    } catch (err) {
      console.error("onboarding chat failed, retrying once:", err);
      response = await call();
    }

    let reply = "";
    let toolInput: OnboardingToolInput | null = null;
    for (const block of response.content) {
      if (block.type === "text") {
        reply += block.text;
      } else if (
        block.type === "tool_use" &&
        block.name === "save_brand_profile"
      ) {
        toolInput = block.input as OnboardingToolInput;
      }
    }
    if (!reply.trim()) reply = "Got it, let's keep going.";
    reply = stripEmDashes(reply);

    const isComplete = toolInput?.complete === true;
    if (toolInput) {
      await applyProfileUpdates(brand, toolInput);
    }

    const nextMessages: OnboardingMessage[] = [
      ...history,
      { role: "user", content: message.trim() },
      { role: "assistant", content: reply },
    ];
    await updateOnboardingState(brandId, {
      messages: nextMessages,
      completed: isComplete,
    });

    return NextResponse.json({ reply, isComplete });
  } catch (err) {
    console.error("onboarding chat error", err);
    return NextResponse.json(
      { error: "Failed to process onboarding turn." },
      { status: 500 },
    );
  }
}

/**
 * Maps the flat tool input onto the brand's nested DB shapes and writes back
 * via the existing full-replacement queries (merging with current values so
 * unrelated fields are preserved). Only touches sections that have updates.
 */
async function applyProfileUpdates(
  brand: Brand,
  input: OnboardingToolInput,
): Promise<void> {
  const has = (...vals: unknown[]) => vals.some((v) => v !== undefined);

  // Brand basics: name + sender.
  if (has(input.name, input.sender_name, input.sender_email)) {
    const ml = brand.mailerlite_config ?? {};
    await updateBrandBasics(brand.id, {
      name: input.name?.trim() || brand.name,
      mailerlite_config: {
        ...ml,
        ...(input.sender_name !== undefined && { sender_name: input.sender_name }),
        ...(input.sender_email !== undefined && { sender_email: input.sender_email }),
      },
      seo_defaults: brand.seo_defaults,
    });
  }

  // Positioning.
  if (
    has(
      input.business_description,
      input.tagline,
      input.differentiators,
      input.competitors,
    )
  ) {
    const cur = brand.positioning ?? {};
    const next: Positioning = {
      ...cur,
      ...(input.business_description !== undefined && {
        business_description: input.business_description,
      }),
      ...(input.tagline !== undefined && { tagline: input.tagline }),
      ...(input.differentiators !== undefined && {
        differentiators: input.differentiators,
      }),
      ...(input.competitors !== undefined && { competitors: input.competitors }),
    };
    await updatePositioning(brand.id, next);
  }

  // Voice.
  if (has(input.voice, input.tone, input.banned_terms)) {
    const cur = brand.voice_profile ?? {};
    const next: VoiceProfile = {
      ...cur,
      ...(input.voice !== undefined && { voice: input.voice }),
      ...(input.tone !== undefined && { tone: input.tone }),
      ...(input.banned_terms !== undefined && { banned_terms: input.banned_terms }),
    };
    await updateBrandVoice(brand.id, next);
  }

  // ICP, needs a strategy + primary ICP row.
  if (
    has(
      input.icp_label,
      input.icp_demographics,
      input.icp_pains,
      input.icp_vocabulary,
      input.icp_jobs,
      input.icp_objections,
    )
  ) {
    const { primaryIcp } = await ensureStrategyAndPrimaryIcp(brand.id);
    const cur = (primaryIcp.profile ?? {}) as IcpProfile;
    const next: IcpProfile = {
      ...cur,
      ...(input.icp_demographics !== undefined && {
        demographics: input.icp_demographics,
      }),
      ...(input.icp_pains !== undefined && { pains: input.icp_pains }),
      ...(input.icp_vocabulary !== undefined && {
        vocabulary: input.icp_vocabulary,
      }),
      ...(input.icp_jobs !== undefined && {
        jobs_to_be_done: input.icp_jobs,
      }),
      ...(input.icp_objections !== undefined && {
        objections: input.icp_objections,
      }),
    };
    await updateIcp(primaryIcp.id, {
      label: input.icp_label?.trim() || primaryIcp.label,
      profile: next,
    });
  }
}
