import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getDraftStatuses,
  getSingleBrand,
  listDrafts,
  listMediaAssets,
  type DraftStatusSummary,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { EmptyState, LinkButton } from "@/components/ui";
import { KIND_ART, MEDIA_ART } from "../_components/art";
import { PieceCard } from "../_components/piece-card";
import { ScreenHeader } from "../_components/screen-header";

export const dynamic = "force-dynamic";

// One door to everything already made. Each kind keeps its own list page
// (filters, archive, bulk actions); this puts them in one place and shows
// the newest pieces underneath.
export default async function LibraryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getSingleBrand(user.id).catch(() => null);
  if (!brand) redirect("/onboarding");

  const [drafts, media] = await Promise.all([
    listDrafts(brand.id).catch(() => []),
    listMediaAssets(brand.id).catch(() => []),
  ]);
  // Counts match each list page's "All" tab; the newest grid skips old
  // versions a regenerate replaced.
  const active = drafts.filter((d) => !d.archived);
  const latest = active.filter((d) => d.state !== "superseded").slice(0, 12);
  const statuses: Record<string, DraftStatusSummary> = await getDraftStatuses(
    brand.id,
    latest.map((d) => d.id),
  ).catch(() => ({}));
  const countOf = (type: string) => active.filter((d) => d.job_type === type).length;

  const sections: { href: string; label: string; art: StaticImageData; count: number; unit: string }[] = [
    { href: "/emails", label: "Emails", art: KIND_ART.email, count: countOf("email"), unit: "email" },
    { href: "/blogs", label: "Blog posts", art: KIND_ART.blog, count: countOf("blog"), unit: "post" },
    { href: "/flyers", label: "Social posts and ads", art: KIND_ART.flyer, count: countOf("social"), unit: "piece" },
    { href: "/media", label: "Media", art: MEDIA_ART, count: media.length, unit: "image" },
  ];

  if (sections.every((s) => s.count === 0)) {
    return (
      <>
        <ScreenHeader title="Library" subtitle="Everything you've made, by kind." />
        <EmptyState
          art={MEDIA_ART}
          title="Nothing made yet"
          action={
            <LinkButton href="/" variant="gradient" size="sm">
              Make your first piece
            </LinkButton>
          }
        >
          Emails, posts, flyers and images all land here, sorted by kind.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Library" subtitle="Everything you've made, by kind." />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {sections.map(({ href, label, art, count, unit }) => (
          <li key={href}>
            <Link href={href} className="group block h-full">
              <div className="h-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface transition-[border-color,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong">
                <div className="art-frame aspect-[5/4] overflow-hidden">
                  <Image
                    src={art}
                    alt=""
                    sizes="(min-width: 768px) 200px, 45vw"
                    placeholder="blur"
                    className="h-full w-full scale-[1.1] object-cover transition-transform duration-500 group-hover:scale-[1.2]"
                  />
                </div>
                <div className="p-3.5">
                  <p className="text-[15px] font-semibold leading-snug text-foreground">{label}</p>
                  <p className="mt-0.5 text-[13px] tabular-nums text-muted">
                    {count} {unit}
                    {count === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {latest.length > 0 && (
        <section className="mt-10" aria-label="Latest">
          <h2 className="mb-3 font-display text-[18px] font-semibold tracking-tight text-foreground">
            Latest
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {latest.map((d) => {
              const piece = statuses[d.id];
              if (!piece) return null;
              return (
                <li key={d.id}>
                  <PieceCard
                    piece={piece}
                    title={piece.subject || d.subject || d.topic_title || "Untitled"}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
