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
// supporting line, and logo set in code with the brand's real fonts and
// colors. Spelling is exact because the text never passes through the image
// model. Rendered with next/og (bundled with Next, no extra dependency).

export interface FlyerText {
  headline: string;
  subtext?: string;
}

interface LoadedLogo {
  uri: string;
  /** width / height of the PNG, shadow margin included. */
  aspect: number;
}

const logoCache = new Map<string, Promise<LoadedLogo | null>>();

/** The brand logo as a PNG data URI (webp/svg/whatever in, PNG out), once per
 * URL per server instance. Null on any failure: the flyer just has no logo.
 * Uploaded logos often carry a wide empty margin that shrinks the mark to a
 * speck, so it's trimmed off, and a soft shadow is baked in so the logo reads
 * on any artwork without sitting in a box. */
function loadLogo(url: string): Promise<LoadedLogo | null> {
  let pending = logoCache.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`logo fetch ${res.status}`);
      const mark = await sharp(Buffer.from(await res.arrayBuffer()), { density: 300 })
        .trim()
        .resize({ height: 200, withoutEnlargement: true })
        .ensureAlpha()
        .png()
        .toBuffer();
      const { width = 200, height = 200 } = await sharp(mark).metadata();
      const blur = 10;
      const pad = blur * 2;
      const size = { width: width + pad * 2, height: height + pad * 2 };
      const alpha = await sharp(mark)
        .extractChannel("alpha")
        .linear(0.55, 0)
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#000000" })
        .blur(blur)
        .extractChannel(0)
        .raw()
        .toBuffer();
      const shadow = await sharp({ create: { ...size, channels: 3, background: "#000000" } })
        .joinChannel(alpha, { raw: { ...size, channels: 1 } })
        .png()
        .toBuffer();
      const png = await sharp(shadow)
        .composite([{ input: mark, left: pad, top: pad }])
        .png()
        .toBuffer();
      return {
        uri: `data:image/png;base64,${png.toString("base64")}`,
        aspect: size.width / size.height,
      };
    })().catch((err) => {
      logWarn("flyer:compose:logo", err instanceof Error ? err.message : String(err), { url });
      return null;
    });
    logoCache.set(url, pending);
  }
  return pending;
}

/** Logo height on a flyer of width W: big enough to read, capped in width so
 * a long wordmark doesn't run across the top. */
function logoHeight(aspect: number, W: number): number {
  const s = W / 1080;
  return Math.round(Math.min(120 * s, (420 * s) / aspect));
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
    </div>
  );

  const logoChip = logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo.uri}
      alt=""
      style={{ height: logoHeight(logo.aspect, W), width: Math.round(logoHeight(logo.aspect, W) * logo.aspect) }}
    />
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
 * distort it), so it's stamped here instead, inset like the composed layouts.
 * No logo on file: unchanged.
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
  const loaded = args.tokens.logo_url ? await loadLogo(args.tokens.logo_url) : null;
  if (!loaded) return base;

  const logoH = logoHeight(loaded.aspect, W);
  const logo = await sharp(Buffer.from(loaded.uri.split(",")[1], "base64"))
    .resize({ height: logoH })
    .png()
    .toBuffer();
  const { width: logoW = logoH } = await sharp(logo).metadata();
  const inset = Math.round(64 * (W / 1080));
  const left = args.corner.endsWith("left") ? inset : W - inset - logoW;
  const top = args.corner.startsWith("top") ? inset : H - inset - logoH;
  return sharp(base).composite([{ input: logo, left, top }]).png().toBuffer();
}
