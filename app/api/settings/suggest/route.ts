import { NextRequest, NextResponse } from "next/server";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import { getBrandWithIcps } from "@/lib/db/queries";
import { buildSuggestMessages, type SuggestField } from "@/prompts/suggest";
import { logError } from "@/lib/log";

export const maxDuration = 300;

const KNOWN_FIELDS: SuggestField[] = [
  "business_description",
  "tagline",
  "differentiators",
  "competitors",
];

/**
 * Returns an AI-drafted value for ONE profile field. Does NOT persist, the
 * caller applies the suggestion in the form and saves via the normal PATCH.
 * This is the "human-owned" guarantee: AI suggests, human edits and saves.
 */
export async function POST(req: NextRequest) {
  try {
    const { field, currentValue } = (await req.json()) as {
      field: string;
      currentValue?: string | string[];
    };

    if (!field || !(KNOWN_FIELDS as string[]).includes(field)) {
      return NextResponse.json({ error: "Unknown field" }, { status: 400 });
    }

    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const primaryIcp = data.icps.find((i) => i.is_primary) ?? data.icps[0] ?? null;

    const { system, user } = buildSuggestMessages(
      data.brand,
      primaryIcp,
      field as SuggestField,
      currentValue,
    );

    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    });
    logUsage("settings-suggest", DRAFT_MODEL, response.usage);

    const suggestion = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n")
      .trim();

    return NextResponse.json({ suggestion });
  } catch (err) {
    logError("api:/api/settings/suggest", err);
    return NextResponse.json(
      { error: "Failed to generate a suggestion" },
      { status: 500 },
    );
  }
}
