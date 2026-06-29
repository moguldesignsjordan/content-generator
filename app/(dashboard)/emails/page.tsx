import { isSupabaseConfigured } from "@/lib/db/client";
import { listDrafts } from "@/lib/db/queries";
import { Card } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { EmailsList } from "./emails-list";

export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your drafts.
        </p>
      </Card>
    );
  }

  let drafts: Awaited<ReturnType<typeof listDrafts>>;
  try {
    drafts = await listDrafts();
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load drafts
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Emails"
        subtitle="Every draft, newest first. Tap to review and approve."
      />
      <EmailsList drafts={drafts} />
    </>
  );
}
