import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getPromptLog, getUserRole } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { Badge, Card } from "@/components/ui";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../../_components/screen-header";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Read-only viewer for one captured AI request. The goal is legibility: the
// admin is here to READ the assembled context and judge it, so prompt text
// renders as text (pre-wrap, never truncated) and only machine-shaped parts
// (tool schemas, thinking config, leftovers) collapse into raw JSON.
// Server-rendered with <details> for collapsing, so there's no client JS.
// ─────────────────────────────────────────────────────────────────────────────

interface ContentBlock {
  type?: string;
  text?: string;
  cache_control?: unknown;
  name?: string;
  input?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

function asBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

function PromptText({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-foreground">
      {text}
    </pre>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Block({ block }: { block: ContentBlock }) {
  const cached = Boolean(block.cache_control);
  if (block.type === "text" || typeof block.text === "string") {
    return (
      <div>
        {cached && (
          <div className="mb-1">
            <Badge tone="amber">cache breakpoint</Badge>
          </div>
        )}
        <PromptText text={block.text ?? ""} />
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Badge tone="neutral">{block.type ?? "block"}</Badge>
        {typeof block.name === "string" && (
          <span className="text-[12px] text-muted">{block.name}</span>
        )}
        {cached && <Badge tone="amber">cache breakpoint</Badge>}
      </div>
      <JsonBlock value={block} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-2">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const ROLE_TONE = { user: "cyan", assistant: "magenta" } as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Keys rendered as dedicated sections or meta chips; whatever remains lands
// in the raw "everything else" fold so new API params are never invisible.
const HANDLED_KEYS = new Set([
  "model",
  "system",
  "messages",
  "tools",
  "prompt",
  "max_tokens",
  "temperature",
  "stream",
  "thinking",
]);

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const role = user && isSupabaseConfigured() ? await getUserRole(user.id) : "user";
    if (role !== "admin") notFound();
  }
  if (!isSupabaseConfigured()) notFound();

  const { id } = await params;
  const log = await getPromptLog(id).catch(() => null);
  if (!log) notFound();

  const req = log.request;
  const system = req.system;
  const messages = Array.isArray(req.messages)
    ? (req.messages as { role?: string; content?: unknown }[])
    : [];
  const tools = Array.isArray(req.tools)
    ? (req.tools as { name?: string; description?: string }[])
    : [];
  const rest = Object.fromEntries(
    Object.entries(req).filter(([k]) => !HANDLED_KEYS.has(k)),
  );

  const metaChips: string[] = [
    formatTime(log.created_at),
    log.endpoint,
    ...(typeof req.max_tokens === "number" ? [`max_tokens ${req.max_tokens}`] : []),
    ...(typeof req.temperature === "number" ? [`temp ${req.temperature}`] : []),
    ...(req.stream === true ? ["streaming"] : []),
    ...(req.thinking ? [`thinking: ${JSON.stringify(req.thinking)}`] : []),
    `${Math.round(log.char_count / 1024)} KB`,
  ];

  return (
    <>
      <Link
        href="/prompts"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} />
        All prompts
      </Link>

      <ScreenHeader
        title={log.model ?? log.provider}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <Badge tone={log.provider === "anthropic" ? "violet" : "cyan"}>
              {log.provider}
            </Badge>
            {metaChips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </span>
        }
      />

      <Card className="p-5 sm:p-6">
        {system != null && (
          <Section title="System prompt">
            {asBlocks(system).map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </Section>
        )}

        {typeof req.prompt === "string" && (
          <Section title="Prompt">
            <PromptText text={req.prompt} />
          </Section>
        )}

        {messages.length > 0 && (
          <Section title={`Messages (${messages.length})`}>
            {messages.map((msg, i) => (
              <div key={i}>
                <div className="mb-1">
                  <Badge
                    tone={
                      ROLE_TONE[msg.role as keyof typeof ROLE_TONE] ?? "neutral"
                    }
                  >
                    {msg.role ?? "message"}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {asBlocks(msg.content).map((block, j) => (
                    <Block key={j} block={block} />
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        {tools.length > 0 && (
          <Section title={`Tools (${tools.length})`}>
            {tools.map((tool, i) => (
              <details key={i} className="group rounded-md border border-border">
                <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[13px] font-medium text-foreground">
                  {tool.name ?? `tool ${i + 1}`}
                  {tool.description && (
                    <span className="ml-2 font-normal text-muted">
                      {tool.description.split("\n")[0].slice(0, 100)}
                    </span>
                  )}
                </summary>
                <div className="border-t border-border p-2">
                  <JsonBlock value={tool} />
                </div>
              </details>
            ))}
          </Section>
        )}

        {Object.keys(rest).length > 0 && (
          <Section title="Everything else">
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[13px] font-medium text-foreground">
                Remaining request fields ({Object.keys(rest).join(", ")})
              </summary>
              <div className="border-t border-border p-2">
                <JsonBlock value={rest} />
              </div>
            </details>
          </Section>
        )}
      </Card>
    </>
  );
}
