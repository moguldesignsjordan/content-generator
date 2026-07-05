import Link from "next/link";
import { getSingleBrand } from "@/lib/db/queries";
import { isSupabaseConfigured } from "@/lib/db/client";
import { Card } from "@/components/ui";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { resolveBrandTokens } from "@/lib/email/templates/types";
import { renderBrandBookTemplate } from "@/lib/brand-book/templates";
import type { BrandBookTemplateId } from "@/lib/brand-book/types";
import { ScreenHeader } from "../../_components/screen-header";
import { BrandGuidelinesView } from "./_components/brand-guidelines-view";

export const dynamic = "force-dynamic";

const TEMPLATE_IDS: BrandBookTemplateId[] = ["bold_spectrum", "clean_minimal"];

/**
 * Renders the brand's approved (or in-progress) guidelines as a polished,
 * shareable document. Reads brand.guidelines/positioning/visual_identity,
 * all of which are already generated, reviewed, and saved elsewhere
 * (Settings, onboarding) — this page is a pure renderer plus, when nothing's
 * been approved yet, the same Generate/Save entry point.
 */
export default async function BrandGuidelinesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <p className="text-sm text-muted">
          Connect Supabase first, see the dashboard for setup steps.
        </p>
      </Card>
    );
  }

  let brand: Awaited<ReturnType<typeof getSingleBrand>>;
  try {
    brand = await getSingleBrand();
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load your brand
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  if (!brand) {
    return (
      <Card className="p-7">
        <p className="text-sm text-muted">
          No brand yet. Finish onboarding first.
        </p>
      </Card>
    );
  }

  const tokens = resolveBrandTokens(brand);
  const documents = Object.fromEntries(
    TEMPLATE_IDS.map((id) => [
      id,
      renderBrandBookTemplate(id, {
        brandName: brand!.name,
        tokens,
        guidelines: brand!.guidelines,
        positioning: brand!.positioning,
      }),
    ]),
  ) as Record<BrandBookTemplateId, string>;

  return (
    <>
      <Link
        href="/settings"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> Settings
      </Link>
      <ScreenHeader
        title="Brand guidelines"
        subtitle="Your logo, colors, type, and voice as a shareable document."
      />
      <BrandGuidelinesView
        brandId={brand.id}
        brandName={brand.name}
        guidelines={brand.guidelines}
        documents={documents}
      />
    </>
  );
}
