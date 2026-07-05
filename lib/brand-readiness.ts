import type { Brand, Icp, Product } from "@/lib/db/types";

// Scores how filled-in the brand brain is. Pure function over stored data, no
// DB access, so the card can render server-side wherever the caller already
// has the rows. Each item maps to the settings surface that fixes it: more
// real inputs (voice examples, products, ICP detail) directly raise copy
// quality, so the card nudges toward the highest-leverage gaps.

export interface ReadinessItem {
  label: string;
  hint: string;
  done: boolean;
  href: string;
}

export function brandReadiness(
  brand: Brand,
  icps: Icp[],
  products: Product[],
): { items: ReadinessItem[]; done: number; total: number } {
  const v = brand.voice_profile ?? {};
  const vi = brand.visual_identity ?? {};
  const pos = brand.positioning ?? {};
  const exampleCount = (v.examples?.length ?? 0) + (v.example_posts?.length ?? 0);

  const items: ReadinessItem[] = [
    {
      label: "Voice and tone",
      hint: "Describe how the brand sounds.",
      done: Boolean(v.voice?.trim() || v.tone?.trim()),
      href: "/settings",
    },
    {
      label: "Writing examples",
      hint: "Two or more real posts or emails to imitate.",
      done: exampleCount >= 2,
      href: "/settings",
    },
    {
      label: "Words to avoid",
      hint: "Terms the copy should never use.",
      done: (v.banned_terms?.length ?? 0) > 0,
      href: "/settings",
    },
    {
      label: "Brand colors",
      hint: "At least a primary and a button color.",
      done: Boolean(vi.colors?.primary && vi.colors?.accent),
      href: "/settings",
    },
    {
      label: "Logo",
      hint: "Shown at the top of every email.",
      done: Boolean(vi.logo_url),
      href: "/settings",
    },
    {
      label: "Audience (ICP)",
      hint: "Who the content is written for.",
      done: icps.length > 0,
      href: "/settings",
    },
    {
      label: "Products or services",
      hint: "What the emails ultimately sell.",
      done: products.length > 0,
      href: "/settings",
    },
    {
      label: "Positioning",
      hint: "What the business does and what sets it apart.",
      done: Boolean(
        pos.business_description?.trim() || (pos.differentiators?.length ?? 0) > 0,
      ),
      href: "/settings",
    },
    {
      label: "Brand guidelines approved",
      hint: "Synthesized rules every draft follows.",
      done: Boolean(brand.guidelines?.approved_at),
      href: "/settings",
    },
    {
      label: "Mailing address",
      hint: "Required by law in marketing email footers.",
      done: Boolean(vi.footer?.postal_address?.trim()),
      href: "/settings",
    },
  ];

  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
  };
}
