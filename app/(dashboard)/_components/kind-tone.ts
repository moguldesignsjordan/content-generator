import type { BadgeTone } from "@/components/ui";
import type { FactoryKind } from "@/lib/db/types";

/** Badge color per kind of piece, shared by every card grid. */
export const KIND_TONE: Record<FactoryKind, BadgeTone> = {
  social: "magenta",
  ad: "amber",
  email: "cyan",
  blog: "violet",
};
