import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSingleBrand, listStyleReferences, listTopics } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../../_components/screen-header";
import { NewFlyerForm } from "../_components/new-flyer-form";

export const dynamic = "force-dynamic";

export default async function NewFlyerPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to design flyers.
        </p>
      </Card>
    );
  }

  let topics: Awaited<ReturnType<typeof listTopics>> = [];
  let styles: Awaited<ReturnType<typeof listStyleReferences>> = [];
  try {
    const user = await getSessionUser();
    const brand = user ? await getSingleBrand(user.id) : null;
    if (brand) {
      topics = await listTopics(brand.id);
      styles = await listStyleReferences(brand.id);
    }
  } catch {
    // Non-fatal: the form still works with an empty topic list (freeform path).
  }

  return (
    <>
      <Link
        href="/flyers"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> Flyers
      </Link>
      <ScreenHeader
        title="New flyer"
        subtitle="Design a Facebook/Instagram post from a topic or a quick brief."
      />
      <NewFlyerForm
        topics={topics.map((t) => ({ id: t.id, title: t.title, pillar: t.pillar }))}
        styles={styles.map((s) => ({ id: s.id, name: s.name, imageUrl: s.image_url }))}
      />
    </>
  );
}
