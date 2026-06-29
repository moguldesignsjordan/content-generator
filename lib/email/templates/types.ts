import "server-only";
import type {
  Brand,
  BrandColors,
  BrandFonts,
  BrandFooter,
  EmailCopy,
  EmailTemplateId,
} from "@/lib/db/types";

// Resolved brand tokens with defaults filled so a template never breaks on an
// incomplete profile. Every field is present.
export interface BrandTokens {
  logo_url: string | null;
  logo_alt: string;
  colors: Required<BrandColors>;
  fonts: Required<BrandFonts>;
  footer: BrandFooter;
  sender_name: string;
}

export interface RenderArgs {
  copy: EmailCopy;
  tokens: BrandTokens;
}

export interface EmailTemplate {
  id: EmailTemplateId;
  label: string; // human label, e.g. "Newsletter: Quick Tip"
  description: string; // one-line guidance shown in any future picker
  render: (args: RenderArgs) => string; // returns inline-styled HTML string
}

// Fills a brand's visual_identity with sensible defaults so generation works
// before the profile is complete. Pure function, safe to call with a partial.
export function resolveBrandTokens(brand: Brand): BrandTokens {
  const vi = brand.visual_identity ?? {};
  const colors = vi.colors ?? {};
  const fonts = vi.fonts ?? {};
  const senderName =
    (brand.mailerlite_config?.sender_name as string | undefined) ?? brand.name;

  return {
    logo_url: vi.logo_url ?? null,
    logo_alt: vi.logo_alt ?? brand.name,
    colors: {
      primary: colors.primary ?? "#0F172A",
      secondary: colors.secondary ?? "#475569",
      accent: colors.accent ?? "#2563EB",
      background: colors.background ?? "#FFFFFF",
      text: colors.text ?? "#0F172A",
      muted: colors.muted ?? "#64748B",
    },
    fonts: {
      heading: fonts.heading ?? "Georgia, 'Times New Roman', serif",
      body: fonts.body ?? "Inter, system-ui, -apple-system, sans-serif",
    },
    footer: vi.footer ?? {},
    sender_name: senderName,
  };
}
