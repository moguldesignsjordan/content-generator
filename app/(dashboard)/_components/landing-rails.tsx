import Link from "next/link";
import type { DraftStatusSummary } from "@/lib/db/queries";
import { PieceCard } from "./piece-card";

export interface RailPiece {
  piece: DraftStatusSummary;
  title: string;
}

/**
 * The landing's rows under the kind tiles: pieces waiting for a decision, then
 * the latest finished work. Each scrolls sideways; an empty row is left out.
 */
export function LandingRails({
  waiting,
  waitingTotal,
  scheduledWaiting,
  recent,
}: {
  waiting: RailPiece[];
  /** All pieces in review; the row itself shows the newest few. */
  waitingTotal: number;
  /** How many waiting pieces a recurring schedule made on its own. */
  scheduledWaiting: number;
  recent: RailPiece[];
}) {
  if (!waiting.length && !recent.length) return null;
  return (
    <div className="space-y-8">
      {waiting.length > 0 && (
        <Rail
          title="Waiting on you"
          count={waitingTotal}
          note={
            scheduledWaiting > 0
              ? `${scheduledWaiting} made on a schedule. Nothing goes out until you approve it.`
              : "Nothing goes out until you approve it."
          }
          href="/review"
          linkLabel="Review all"
          items={waiting}
        />
      )}
      {recent.length > 0 && (
        <Rail title="Recent work" href="/library" linkLabel="Library" items={recent} />
      )}
    </div>
  );
}

function Rail({
  title,
  count,
  note,
  href,
  linkLabel,
  items,
}: {
  title: string;
  count?: number;
  note?: string;
  href: string;
  linkLabel: string;
  items: RailPiece[];
}) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[18px] font-semibold tracking-tight text-foreground">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 font-sans text-[12px] font-semibold tabular-nums tracking-normal text-accent">
                {count}
              </span>
            )}
          </h2>
          {note && <p className="mt-0.5 text-[12.5px] text-muted">{note}</p>}
        </div>
        <Link
          href={href}
          className="shrink-0 text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
        >
          {linkLabel} →
        </Link>
      </div>
      <div className="rail-fade -mx-4 sm:mx-0">
        <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:px-0">
          {items.map(({ piece, title: pieceTitle }) => (
            <PieceCard key={piece.id} piece={piece} title={pieceTitle} size="rail" />
          ))}
        </div>
      </div>
    </section>
  );
}
