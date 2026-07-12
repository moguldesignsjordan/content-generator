"use client";

import { useState } from "react";
import { ListGroup, ListRow, Sheet } from "@/components/ui";
import { LogoutIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/supabase/actions";
import type {
  Brand,
  ContentJobType,
  ContentSchedule,
  Icp,
  Product,
  Strategy,
} from "@/lib/db/types";
import type { ProviderField } from "@/lib/publishing/provider";
import type { ConnectionState } from "@/lib/publishing/connections";
import { BrandBasicsForm } from "./brand-basics-form";
import { ImportWebsiteForm } from "./import-website-form";
import { BrandVoiceForm } from "./brand-voice-form";
import { PositioningForm } from "./positioning-form";
import { VisualIdentityForm } from "./visual-identity-form";
import { GuidelinesForm } from "./guidelines-form";
import { ProductsForm } from "./products-form";
import { FunnelForm } from "./funnel-form";
import { IcpForm } from "./icp-form";
import { ConnectionForm } from "./connection-form";
import { SchedulesForm } from "./schedules-form";

type SectionKey =
  | "import"
  | "basics"
  | "voice"
  | "positioning"
  | "visual"
  | "guidelines"
  | "products"
  | "funnel"
  | "icp"
  | "schedules";

export interface ConnectionStatus {
  id: string;
  label: string;
  kind: ContentJobType;
  configHint: string;
  fields: ProviderField[];
  state: ConnectionState;
  values: Record<string, string | string[]>;
  secretIsSet: Record<string, boolean>;
}

export function SettingsClient({
  brand,
  strategy,
  primaryIcp,
  products,
  connections = [],
  schedules = [],
}: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
  products: Product[];
  connections?: ConnectionStatus[];
  schedules?: ContentSchedule[];
}) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  // Open connection sheet keyed by provider id (separate from SectionKey so
  // adding a provider needs no enum change here).
  const [openConnection, setOpenConnection] = useState<string | null>(null);
  const close = () => setOpen(null);

  return (
    <div>
      <ListGroup label="Brand">
        <ListRow
          title="Import from website"
          subtitle="Pull voice, positioning, offers, and visuals from your site"
          onClick={() => setOpen("import")}
        />
        <ListRow
          title="Generate brand identity"
          subtitle="No website? Generate your full brand guidelines document, palette included"
          href="/settings/brand-guidelines"
        />
        <ListRow
          title="Brand basics"
          subtitle="Name, sender identity, SEO geography"
          onClick={() => setOpen("basics")}
        />
        <ListRow
          title="Voice"
          subtitle="Personality and guardrails for every draft"
          onClick={() => setOpen("voice")}
        />
        <ListRow
          title="Positioning"
          subtitle="What you do, tagline, differentiators"
          onClick={() => setOpen("positioning")}
        />
        <ListRow
          title="Visual identity"
          subtitle="Logo, colors, typography for emails"
          onClick={() => setOpen("visual")}
        />
        <ListRow
          title="Brand guidelines"
          subtitle="AI-drafted from everything stored, approved by you"
          onClick={() => setOpen("guidelines")}
        />
      </ListGroup>

      <ListGroup label="Strategy">
        <ListRow
          title="Products & services"
          subtitle="The offers your emails pitch, scope, pricing, links"
          onClick={() => setOpen("products")}
        />
        {strategy ? (
          <ListRow
            title="Funnel"
            subtitle="Map each stage to a CTA type"
            onClick={() => setOpen("funnel")}
          />
        ) : (
          <ListRow
            title="Funnel"
            subtitle="Available after onboarding"
            chevron={false}
          />
        )}
        {primaryIcp ? (
          <ListRow
            title="Primary ICP"
            subtitle="Who you write for"
            onClick={() => setOpen("icp")}
          />
        ) : (
          <ListRow
            title="Primary ICP"
            subtitle="Available after onboarding"
            chevron={false}
          />
        )}
      </ListGroup>

      <ListGroup label="Automation">
        <ListRow
          title="Recurring schedules"
          subtitle={
            schedules.length > 0
              ? `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}`
              : "Auto-generate drafts on a cadence, still human-approved"
          }
          onClick={() => setOpen("schedules")}
        />
      </ListGroup>

      {connections.length > 0 && (
        <ListGroup label="Connections">
          {connections.map((c) => (
            <ListRow
              key={c.id}
              title={c.label}
              subtitle={connectionSubtitle(c)}
              onClick={() => setOpenConnection(c.id)}
            />
          ))}
        </ListGroup>
      )}

      <ListGroup label="Account">
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-danger transition-colors min-h-[52px] hover:bg-surface-2"
          >
            <LogoutIcon size={20} />
            <span className="text-[15px] font-medium">Sign out</span>
          </button>
        </form>
      </ListGroup>

      {/* Section sheets */}
      <Sheet
        open={open === "import"}
        onClose={close}
        title="Import from website"
        description="Scan your site for voice, positioning, offers, and visuals. You review everything before it's saved."
        size="xl"
      >
        <ImportWebsiteForm brand={brand} products={products} />
      </Sheet>

      <Sheet
        open={open === "basics"}
        onClose={close}
        title="Brand basics"
        description="Name, sender identity, SEO geography."
        size="lg"
      >
        <BrandBasicsForm
          brandId={brand.id}
          name={brand.name}
          mailerliteConfig={brand.mailerlite_config}
          seoDefaults={brand.seo_defaults}
        />
      </Sheet>

      <Sheet
        open={open === "voice"}
        onClose={close}
        title="Voice"
        description="The personality and guardrails injected into every prompt. Example posts are the biggest quality lever."
        size="xl"
      >
        <BrandVoiceForm
          brandId={brand.id}
          voiceProfile={brand.voice_profile}
        />
      </Sheet>

      <Sheet
        open={open === "positioning"}
        onClose={close}
        title="Positioning"
        description="What you do, your tagline, what sets you apart, and who you're up against."
        size="lg"
      >
        <PositioningForm
          brandId={brand.id}
          positioning={brand.positioning}
        />
      </Sheet>

      <Sheet
        open={open === "visual"}
        onClose={close}
        title="Visual identity"
        description="How the brand looks. Logo, colors, and typography are injected into the email templates."
        size="xl"
      >
        <VisualIdentityForm
          brandId={brand.id}
          visualIdentity={brand.visual_identity}
          brandName={brand.name}
        />
      </Sheet>

      <Sheet
        open={open === "products"}
        onClose={close}
        title="Products & services"
        description="What generation pitches when a topic maps to an offer. Real scope and pricing make the copy concrete."
        size="xl"
      >
        <ProductsForm brandId={brand.id} products={products} />
      </Sheet>

      <Sheet
        open={open === "schedules"}
        onClose={close}
        title="Recurring schedules"
        description="Auto-generates a draft on a cadence and leaves it awaiting review. It never auto-publishes."
        size="lg"
      >
        <SchedulesForm brandId={brand.id} schedules={schedules} />
      </Sheet>

      <Sheet
        open={open === "guidelines"}
        onClose={close}
        title="Brand guidelines"
        description="The document every generation prompt leads with. Generate a draft, edit it until it's right, then save to approve."
        size="xl"
      >
        <GuidelinesForm brandId={brand.id} guidelines={brand.guidelines} />
      </Sheet>

      {strategy && (
        <Sheet
          open={open === "funnel"}
          onClose={close}
          title="Funnel configuration"
          description="Maps each funnel stage to a CTA type. Keys must match your CTA library."
          size="md"
        >
          <FunnelForm
            strategyId={strategy.id}
            funnelDefinition={strategy.funnel_definition}
          />
        </Sheet>
      )}

      {primaryIcp && (
        <Sheet
          open={open === "icp"}
          onClose={close}
          title="Primary ICP"
          description="Who you're writing for. The more specific, the sharper the copy."
          size="xl"
        >
          <IcpForm icp={primaryIcp} />
        </Sheet>
      )}

      {connections.map((c) => (
        <Sheet
          key={c.id}
          open={openConnection === c.id}
          onClose={() => setOpenConnection(null)}
          title={c.label}
          description="Connect your own account. Credentials are encrypted; server env vars stay as a fallback."
          size="lg"
        >
          <ConnectionForm
            brandId={brand.id}
            providerId={c.id}
            fields={c.fields}
            initial={{
              state: c.state,
              values: c.values,
              secretIsSet: c.secretIsSet,
            }}
          />
        </Sheet>
      ))}
    </div>
  );
}

function connectionSubtitle(c: ConnectionStatus): string {
  const what = c.kind === "blog" ? "blog posts" : "emails";
  if (c.state === "account") return `Connected · publishes ${what}`;
  if (c.state === "env") return `Using server default · publishes ${what}`;
  return "Not connected · tap to set up";
}
