import type { StaticImageData } from "next/image";
import type { FactoryKind } from "@/lib/db/types";
import kindAd from "@/assets/art/kind-ad.webp";
import kindBlog from "@/assets/art/kind-blog.webp";
import kindCampaign from "@/assets/art/kind-campaign.webp";
import kindEmail from "@/assets/art/kind-email.webp";
import kindFlyer from "@/assets/art/kind-flyer.webp";
import media from "@/assets/art/media.webp";
import reviewDone from "@/assets/art/review-done.webp";
import type { StarterKind } from "./create-agent";

// 3D glass art made with Higgsfield (Nano Banana Pro, today's home hero as the
// style reference). It's rendered on pure black, so it always sits in a dark
// .art-frame, light theme included.

export const KIND_ART: Record<StarterKind, StaticImageData> = {
  flyer: kindFlyer,
  email: kindEmail,
  campaign: kindCampaign,
  blog: kindBlog,
  ad: kindAd,
};

/** The same art, keyed by the kinds a made piece can be. */
export const PIECE_ART: Record<FactoryKind, StaticImageData> = {
  social: kindFlyer,
  ad: kindAd,
  email: kindEmail,
  blog: kindBlog,
};

export const MEDIA_ART = media;
export const REVIEW_DONE_ART = reviewDone;
