"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ScheduledSocialPost } from "@/lib/db/queries";

// The weekly batch on one screen: what still needs a look, what's queued for
// the daily cron, and what already went out. "Approve all" is the batch's one
// human approval; a post that needs changes opens in the normal review screen.

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function status(post: ScheduledSocialPost): "writing" | "review" | "queued" | "posted" {
  if (post.generating) return "writing";
  if (post.posts.length) return "posted";
  return post.state === "approved" ? "queued" : "review";
}

const BADGE = {
  writing: { tone: "neutral", text: "Writing" },
  review: { tone: "amber", text: "Needs review" },
  queued: { tone: "cyan", text: "Queued" },
  posted: { tone: "success", text: "Posted" },
} as const;

export function SocialQueue({
  posts,
  connected,
}: {
  posts: ScheduledSocialPost[];
  connected: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [approving, setApproving] = useState(false);
  const reviewable = posts.filter((p) => status(p) === "review" && p.imageUrl);

  async function approveAll() {
    setApproving(true);
    try {
      const res = await fetch("/api/social/approve-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: reviewable.map((p) => p.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { approved?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't approve the posts.");
      toast.success(
        `Approved ${data.approved} post${data.approved === 1 ? "" : "s"}. Each goes out on its day.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve the posts.");
    } finally {
      setApproving(false);
    }
  }

  if (!posts.length) {
    return (
      <Card className="p-6 text-sm text-muted">
        No scheduled posts yet. Add a{" "}
        <Link href="/settings" className="font-medium text-accent hover:text-accent-press">
          Social posts schedule
        </Link>{" "}
        in Settings and the next batch of three (Mon, Wed, Fri) shows up here for review.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted">
          {connected.length
            ? `Posts to ${connected.join(" and ")} around 9am ET on each day.`
            : "No social account connected yet. Connect Facebook in Settings so queued posts can go out."}
        </p>
        {reviewable.length > 0 && (
          <Button variant="gradient" loading={approving} onClick={approveAll}>
            Approve all {reviewable.length}
          </Button>
        )}
      </Card>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => {
          const s = status(post);
          return (
            <li key={post.id}>
              <Link href={`/drafts/${post.id}`} className="block h-full">
                <Card className="h-full overflow-hidden transition-colors hover:border-foreground/20">
                  <div
                    className={cn(
                      "w-full bg-surface-2",
                      post.aspect === "1:1" ? "aspect-square" : "aspect-[4/5]",
                    )}
                  >
                    {post.imageUrl && (
                      // Supabase Storage URL; next/image would need remotePatterns for it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {dayLabel(post.plannedAt)}
                      </span>
                      <Badge tone={BADGE[s].tone}>{BADGE[s].text}</Badge>
                    </div>
                    {post.caption && (
                      <p className="line-clamp-3 text-[13px] text-muted">{post.caption}</p>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
