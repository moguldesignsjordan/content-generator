import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getUserRole, listRecentPromptLogs } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import type { PromptProvider } from "@/lib/db/types";

// Always read fresh; new captures should show up on refresh.
export const dynamic = "force-dynamic";

const PROVIDER_TONE: Record<PromptProvider, BadgeTone> = {
  anthropic: "violet",
  gemini: "cyan",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSize(chars: number): string {
  if (chars >= 1024 * 1024) return `${(chars / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(chars / 1024))} KB`;
}

export default async function PromptsPage() {
  // Admin-only, mirroring /logs: the nav hides the link, this stops direct
  // navigation, and it 404s so the page's existence isn't signaled.
  if (isSupabaseAuthConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const role = user && isSupabaseConfigured() ? await getUserRole(user.id) : "user";
    if (role !== "admin") notFound();
  }

  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local, then apply
          db/migrations/021_prompt_logs.sql to enable prompt capture.
        </p>
      </Card>
    );
  }

  const prompts = await listRecentPromptLogs().catch(() => []);

  return (
    <>
      <ScreenHeader
        title="Prompts"
        subtitle="Every AI request the app sends, captured in full: system prompt, messages, tools. Open one to read the exact context."
      />

      {prompts.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          No prompts captured yet. Generate something, then refresh. If this
          stays empty, apply db/migrations/021_prompt_logs.sql in the Supabase
          SQL editor.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {prompts.map((p) => (
            <Link
              key={p.id}
              href={`/prompts/${p.id}`}
              className="flex flex-col gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2"
            >
              <div className="flex items-center gap-2">
                <Badge tone={PROVIDER_TONE[p.provider]}>{p.provider}</Badge>
                <span className="truncate text-[13px] font-medium text-foreground">
                  {p.model ?? p.endpoint}
                </span>
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-2">
                  {formatTime(p.created_at)}
                </span>
              </div>
              <p className="truncate text-[13px] text-muted">
                {p.preview || "(no system prompt)"}
              </p>
              <div className="flex items-center gap-3 text-[12px] text-muted-2">
                <span>
                  {p.message_count} message{p.message_count === 1 ? "" : "s"}
                </span>
                <span>{formatSize(p.char_count)}</span>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
