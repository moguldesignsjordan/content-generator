"use client";

import { useState } from "react";
import { ListGroup, ListRow, Sheet } from "@/components/ui";
import { LogoutIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/supabase/actions";
import type { Brand, Icp, Strategy } from "@/lib/db/types";
import { BrandBasicsForm } from "./brand-basics-form";
import { BrandVoiceForm } from "./brand-voice-form";
import { PositioningForm } from "./positioning-form";
import { VisualIdentityForm } from "./visual-identity-form";
import { FunnelForm } from "./funnel-form";
import { IcpForm } from "./icp-form";

type SectionKey =
  | "basics"
  | "voice"
  | "positioning"
  | "visual"
  | "funnel"
  | "icp";

export function SettingsClient({
  brand,
  strategy,
  primaryIcp,
}: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
}) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  const close = () => setOpen(null);

  return (
    <div>
      <ListGroup label="Brand">
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
      </ListGroup>

      <ListGroup label="Strategy">
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
    </div>
  );
}
