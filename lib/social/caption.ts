import type { FlyerCopy } from "@/lib/db/types";

// The text posted with a flyer image: the caption, then its hashtags on their
// own line. The headline/subtext are already IN the image, so they're left
// out. Hashtags are stored with or without "#", and may carry spaces.

export function buildSocialCaption(copy: FlyerCopy): string {
  const tags = (copy.hashtags ?? [])
    .map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
  const caption = copy.caption.trim();
  return tags.length ? `${caption}\n\n${tags.join(" ")}` : caption;
}
