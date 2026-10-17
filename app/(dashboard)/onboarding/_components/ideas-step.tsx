"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button, Card, LinkButton, Skeleton } from "@/components/ui";
import { ChevronRightIcon, RefreshIcon } from "@/components/ui/icons";
import type { ReadinessItem } from "@/lib/brand-readiness";

interface Idea {
  id: string;
  title: string;
}

/**
 * Step 5, "You're set": three ideas saved as topics, each one tap into
 * Create, then the top setup items still open. Nothing here spends credits.
 */
export function IdeasStep({ todo }: { todo: ReadinessItem[] }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/ideas", { method: "POST" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { ideas?: Idea[]; error?: string };
        if (!res.ok || !data.ideas) throw new Error(data.error ?? "Couldn't come up with ideas.");
        if (!cancelled) setIdeas(data.ideas);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-foreground">Three ideas to start with</h2>
        <p className="mt-1 text-[12.5px] text-muted">Saved to your content plan. Tap one to make it now.</p>
        <ul className="mt-4 space-y-2.5">
          {error ? (
            <li className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-danger">{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                <RefreshIcon size={15} />
                Try again
              </Button>
            </li>
          ) : ideas ? (
            ideas.map((idea) => (
              <li
                key={idea.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2 p-3 pl-4"
              >
                <span className="min-w-0 text-[14.5px] font-medium leading-snug text-foreground">{idea.title}</span>
                <LinkButton href={`/?idea=${idea.id}&kind=email`} size="sm" variant="solid" className="shrink-0">
                  Make it
                </LinkButton>
              </li>
            ))
          ) : (
            [0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton variant="rect" height={58} className="w-full" />
              </li>
            ))
          )}
        </ul>
      </Card>

      {todo.length > 0 && (
        <Card className="p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-foreground">Before you send email</h2>
          <ul className="mt-3 divide-y divide-border">
            {todo.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="flex items-center justify-between gap-3 py-3 text-[14px]">
                  <span>
                    <span className="font-medium text-foreground">{item.label}</span>
                    <span className="block text-[12.5px] text-muted">{item.hint}</span>
                  </span>
                  <ChevronRightIcon size={16} className="shrink-0 text-muted-2" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex justify-center pt-2">
        <LinkButton href="/" variant="ghost" size="sm">
          Go to the dashboard
        </LinkButton>
      </div>
    </motion.div>
  );
}
