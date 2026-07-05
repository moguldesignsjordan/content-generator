import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { DRAFT_MODEL, getAnthropic, isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import { createDraftShell, getBrandWithIcps, getTopicContext, listTopics } from "@/lib/db/queries";
import { GENERATE_EMAIL_TOOL, buildAssistantSystem } from "@/prompts/assistant";
import { stripEmDashes } from "@/lib/text";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    if (!isSupabaseConfigured() || !isAnthropicConfigured()) {
      return NextResponse.json(
        { error: "Missing configuration. Set SUPABASE_* and ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }

    const { message, history } = (await req.json()) as {
      message?: string;
      history?: ChatMsg[];
    };
    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand, icps } = data;
    const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;
    const topics = await listTopics();

    const system = buildAssistantSystem(brand, primaryIcp, topics);
    const messages: Anthropic.MessageParam[] = [
      ...(history ?? [])
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message.trim() },
    ];

    const first = await callClaude(system, messages);
    let reply = extractText(first);
    let draftId: string | undefined;

    const toolUse = first.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "generate_email",
    );

    if (toolUse) {
      const input = toolUse.input as { topicId?: string };
      const topicId = input.topicId?.trim();
      const valid = topicId && topics.some((t) => t.id === topicId);

      let resultText: string;
      if (!valid) {
        resultText =
          "Error: that topic id is not in the list. Ask the user which topic they mean.";
      } else {
        try {
          const ctx = await getTopicContext(topicId as string);
          if (!ctx) throw new Error(`Topic ${topicId} not found`);
          const newDraftId = await createDraftShell({ ctx });
          draftId = newDraftId;
          resultText = `Success. A new draft was created with id ${newDraftId} and is being written now. Tell the user to open it to watch it come together.`;
        } catch (err) {
          resultText = `Error: could not start generation, ${
            err instanceof Error ? err.message : "unknown error"
          }. Tell the user to try again.`;
        }
      }

      // Feed the tool result back so the model writes a natural follow-up.
      const followMessages: Anthropic.MessageParam[] = [
        ...messages,
        {
          role: "assistant",
          content: first.content as unknown as Anthropic.ContentBlockParam[],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: resultText,
            },
          ],
        },
      ];

      const second = await callClaude(system, followMessages);
      const secondText = extractText(second);
      if (secondText.trim()) reply = secondText;
    }

    reply = stripEmDashes(reply || "Done.");
    return NextResponse.json({ reply, draftId });
  } catch (err) {
    console.error("assistant chat error", err);
    return NextResponse.json(
      { error: "The assistant hit a snag. Try again." },
      { status: 500 },
    );
  }
}

function callClaude(
  system: string,
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  return getAnthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: 1200,
    system,
    messages,
    tools: [GENERATE_EMAIL_TOOL],
    tool_choice: { type: "auto" },
  });
}

function extractText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
