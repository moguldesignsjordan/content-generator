import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DraftStatusSummary } from "@/lib/db/queries";
import type { FactoryKind } from "@/lib/db/types";
import { PIECE_ART } from "./art";
import { KIND_TONE } from "./kind-tone";
import { DraftStateBadge } from "./topic-badges";

const KIND_LABEL: Record<FactoryKind, string> = {
  social: "Social post",
  ad: "Ad",
  email: "Email",
  blog: "Blog post",
};

/** Grids keep each kind's own shape (portrait flyers, square ads, wide
 *  heroes). Rails use one shape so a sideways row lines up. */
const GRID_ASPECT: Record<FactoryKind, string> = {
  social: "aspect-[4/5]",
  ad: "aspect-square",
  email: "aspect-[16/10]",
  blog: "aspect-[16/10]",
};

/**
 * One made piece as a tappable card: its image (or the kind's glass art while
 * it has none), what kind it is, where it stands, and its title. Opens the
 * piece's review page.
 */
export function PieceCard({
  piece,
  title,
  size = "grid",
  className,
}: {
  piece: DraftStatusSummary;
  title: string;
  size?: "rail" | "grid";
  className?: string;
}) {
  return (
    <Link
      href={`/drafts/${piece.id}`}
      className={cn(
        "group block",
        size === "rail" ? "w-[164px] shrink-0 snap-start sm:w-[184px]" : "h-full",
        className,
      )}
    >
      <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface transition-[border-color,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong">
        <div
          className={cn(
            "relative w-full overflow-hidden",
            size === "rail" ? "aspect-[4/5]" : GRID_ASPECT[piece.kind],
          )}
        >
          {piece.imageUrl ? (
            // Supabase Storage URL; next/image would need remotePatterns for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={piece.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="art-frame h-full w-full">
              <Image
                src={PIECE_ART[piece.kind]}
                alt=""
                sizes="184px"
                className={cn(
                  "h-full w-full object-contain p-[14%]",
                  piece.generation === "generating" && "animate-pulse",
                )}
              />
            </div>
          )}
          {/* A dark backing keeps the tinted kind badge readable on any image. */}
          <span className="absolute left-2 top-2 rounded-full bg-black/55 backdrop-blur-md">
            <Badge tone={KIND_TONE[piece.kind]}>{KIND_LABEL[piece.kind]}</Badge>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <p className="line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground">
            {title}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <PieceStatus piece={piece} />
            {piece.qaIssues > 0 && (
              <span className="text-[11.5px] text-warning">
                {piece.qaIssues} note{piece.qaIssues === 1 ? "" : "s"} to check
              </span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

function PieceStatus({ piece }: { piece: DraftStatusSummary }) {
  if (piece.generation === "generating") {
    return (
      <Badge tone="neutral" dot>
        Being made
      </Badge>
    );
  }
  if (piece.generation === "error") return <Badge tone="danger">Failed</Badge>;
  if (piece.state === "in_review") {
    return (
      <Badge tone="amber" dot>
        Needs review
      </Badge>
    );
  }
  return <DraftStateBadge state={piece.state} />;
}
