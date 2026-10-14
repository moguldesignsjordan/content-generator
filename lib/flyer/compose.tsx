import "server-only";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { BrandTokens } from "@/lib/email/templates/types";
import { contrast, readableTextColor } from "@/lib/color/contrast";
import { logWarn } from "@/lib/log";
import { loadFlyerFonts } from "./fonts";
import { artHeightFraction, headlineSize, primaryFontFamily, type FlyerLayout } from "./layout";

// Composes a finished flyer: the model's text-free artwork plus the headline,
// supporting line, CTA, and logo set in code with the brand's real fonts and
// colors. Spelling is exact because the text never passes through the image
// model. Rendered with next/og (bundled with Next, no extra dependency).

export interface FlyerText {
  headline: string;
  subtext?: string;
  cta?: string;
}

const logoCache = new Map<string, Promise<string | null>>();

/** The brand logo as a PNG data URI (webp/svg/whatever in, PNG out), once per
 * URL per server instance. Null on any failure: the flyer just has no logo. */
function loadLogo(url: string): Promise<string | null> {
  let pending = logoCache.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`logo fetch ${res.status}`);
      const png = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize({ height: 200, withoutEnlargement: true })
        .png()
        .toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    })().catch((err) => {
      logWarn("flyer:compose:logo", err instanceof Error ? err.message : String(err), { url });
      return null;
    });
    logoCache.set(url, pending);
  }
  return pending;
}

/** "#abc" → "#aabbcc"; anything that isn't a hex color → the fallback. */
function hex(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return fallback;
}

export async function composeFlyer(args: {
  art: Buffer;
  text: FlyerText;
  tokens: BrandTokens;
  width: number;
  height: number;
  layout: FlyerLayout;
}): Promise<Buffer> {
  const { width: W, height: H, layout, tokens, text } = args;
  const s = W / 1080;
  const pad = Math.round(64 * s);
  const artH = Math.round(H * artHeightFraction(layout, W, H));

  const [artBuf, logo, fontSet] = await Promise.all([
    sharp(args.art)
      .rotate()
      .resize({ width: W, height: artH, fit: "cover", position: "attention" })
      .jpeg({ quality: 92 })
      .toBuffer(),
    tokens.logo_url ? loadLogo(tokens.logo_url) : Promise.resolve(null),
    loadFlyerFonts({
      heading: primaryFontFamily(tokens.fonts.heading),
      body: primaryFontFamily(tokens.fonts.body),
    }),
  ]);
  const artUri = `data:image/jpeg;base64,${artBuf.toString("base64")}`;

  // Colors: the band is the brand's primary; text on every surface is picked
  // for contrast against what's actually behind it.
  const band = hex(tokens.colors.primary, "#111827");
  const accent = hex(tokens.colors.accent, "#7C3AED");
  const cardBg = hex(tokens.colors.background, "#FFFFFF");
  const brandText = hex(tokens.colors.text, "#111827");
  const surface =
    layout === "card" ? cardBg : layout === "gradient" ? "#0B0B0F" : band;
  const textColor =
    layout === "gradient"
      ? "#FAFAFA"
      : contrast(brandText, surface) >= 4.5
        ? brandText
        : readableTextColor(surface);
  // The CTA pill must stand out from the surface it sits on.
  const pillBg = contrast(accent, surface) >= 1.6 ? accent : textColor;
  const pillText = readableTextColor(pillBg);

  const textBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: Math.round(22 * s), width: "100%" }}>
      <div
        style={{
          fontFamily: fontSet.heading,
          fontWeight: 700,
          fontSize: headlineSize(text.headline, W),
          lineHeight: 1.05,
          letterSpacing: "-0.01em",
          color: textColor,
        }}
      >
        {text.headline}
      </div>
      {text.subtext ? (
        <div
          style={{
            fontFamily: fontSet.body,
            fontWeight: 400,
            fontSize: Math.round(W * 0.036),
            lineHeight: 1.3,
            color: textColor,
            opacity: 0.9,
          }}
        >
          {text.subtext}
        </div>
      ) : null}
      {text.cta ? (
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              background: pillBg,
              color: pillText,
              fontFamily: fontSet.heading,
              fontWeight: 700,
              fontSize: Math.round(W * 0.034),
              padding: `${Math.round(18 * s)}px ${Math.round(36 * s)}px`,
              borderRadius: 999,
            }}
          >
            {text.cta}
          </div>
        </div>
      ) : null}
    </div>
  );

  const logoChip = logo ? (
    <div
      style={{
        display: "flex",
        background: cardBg,
        padding: `${Math.round(14 * s)}px ${Math.round(20 * s)}px`,
        borderRadius: Math.round(16 * s),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" style={{ height: Math.round(56 * s) }} />
    </div>
  ) : null;

  const artImg = (top: number) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artUri}
      alt=""
      width={W}
      height={artH}
      style={{ position: "absolute", left: 0, top, width: W, height: artH }}
    />
  );

  let body: ReactNode;
  if (layout === "band_bottom" || layout === "band_top") {
    const bandH = H - artH;
    const bandTop = layout === "band_top" ? 0 : artH;
    body = (
      <>
        {artImg(layout === "band_top" ? bandH : 0)}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: bandTop,
            width: W,
            height: bandH,
            background: band,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: `${Math.round(48 * s)}px ${pad}px`,
          }}
        >
          {textBlock}
        </div>
        {logoChip ? (
          <div
            style={{
              position: "absolute",
              display: "flex",
              left: pad,
              top: layout === "band_top" ? bandH + pad : pad,
            }}
          >
            {logoChip}
          </div>
        ) : null}
      </>
    );
  } else {
    const inset = layout === "card" ? Math.round(W * 0.06) : pad;
    body = (
      <>
        {artImg(0)}
        {layout === "gradient" ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: W,
              height: Math.round(H * 0.62),
              backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))",
            }}
          />
        ) : null}
        {/* Explicit width: the renderer doesn't stretch an absolute box
            between left and right, so without it the text column collapses. */}
        <div
          style={{
            position: "absolute",
            display: "flex",
            left: inset,
            bottom: inset,
            width: W - inset * 2,
            ...(layout === "card"
              ? { background: cardBg, borderRadius: Math.round(28 * s), padding: pad }
              : {}),
          }}
        >
          {textBlock}
        </div>
        {logoChip ? (
          <div style={{ position: "absolute", display: "flex", left: pad, top: pad }}>
            {logoChip}
          </div>
        ) : null}
      </>
    );
  }

  const image = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: band }}>
        {body}
      </div>
    ),
    {
      width: W,
      height: H,
      ...(fontSet.fonts.length ? { fonts: fontSet.fonts } : {}),
    },
  );
  return Buffer.from(await image.arrayBuffer());
}

/**
 * Places the brand logo, exactly as uploaded, on an AI-designed flyer at the
 * corner its look names. The image model never redraws a logo (it would
 * distort it), so it's stamped here instead: a small chip on the brand's
 * light color, inset like the composed layouts. No logo on file: unchanged.
 */
export async function stampLogo(args: {
  image: Buffer;
  tokens: BrandTokens;
  width: number;
  height: number;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}): Promise<Buffer> {
  const { width: W, height: H } = args;
  const base = await sharp(args.image).rotate().resize({ width: W, height: H, fit: "cover" }).toBuffer();
  const logoUri = args.tokens.logo_url ? await loadLogo(args.tokens.logo_url) : null;
  if (!logoUri) return base;

  const s = W / 1080;
  const logoH = Math.round(56 * s);
  const padX = Math.round(20 * s);
  const padY = Math.round(14 * s);
  const logo = await sharp(Buffer.from(logoUri.split(",")[1], "base64"))
    .resize({ height: logoH })
    .png()
    .toBuffer();
  const { width: logoW = logoH } = await sharp(logo).metadata();
  const chipW = logoW + padX * 2;
  const chipH = logoH + padY * 2;
  const radius = Math.round(16 * s);
  const chipBg = hex(args.tokens.colors.background, "#FFFFFF");
  const chip = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${chipW}" height="${chipH}"><rect width="${chipW}" height="${chipH}" rx="${radius}" fill="${chipBg}"/></svg>`,
    ),
  )
    .composite([{ input: logo, left: padX, top: padY }])
    .png()
    .toBuffer();
  const inset = Math.round(64 * s);
  const left = args.corner.endsWith("left") ? inset : W - inset - chipW;
  const top = args.corner.startsWith("top") ? inset : H - inset - chipH;
  return sharp(base).composite([{ input: chip, left, top }]).png().toBuffer();
}
