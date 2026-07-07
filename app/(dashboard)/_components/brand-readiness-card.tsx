import Link from "next/link";
import { Card } from "@/components/ui";
import type { ReadinessItem } from "@/lib/brand-readiness";

// Shows what's still missing from the brand brain. Renders nothing once
// everything is filled in; the goal is a nudge, not a permanent fixture.
export function BrandReadinessCard({
  items,
  done,
  total,
}: {
  items: ReadinessItem[];
  done: number;
  total: number;
}) {
  const missing = items.filter((i) => !i.done);
  if (missing.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">
          Brand readiness
        </h2>
        <span className="text-[13px] text-muted">
          {done}/{total} complete
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-amber transition-[width]"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-[13px] text-muted">
        The more of these are filled in, the more on-brand every draft comes out.
      </p>
      <ul className="mt-3 space-y-1.5">
        {missing.slice(0, 4).map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="group flex items-baseline gap-2 text-[13px]"
            >
              <span className="text-muted">○</span>
              <span className="font-medium text-foreground group-hover:text-accent">
                {item.label}
              </span>
              <span className="text-muted">{item.hint}</span>
            </Link>
          </li>
        ))}
        {missing.length > 4 && (
          <li className="pl-5 text-[13px] text-muted">
            and {missing.length - 4} more in{" "}
            <Link href="/settings" className="text-accent hover:text-accent-press">
              Settings
            </Link>
          </li>
        )}
      </ul>
    </Card>
  );
}
