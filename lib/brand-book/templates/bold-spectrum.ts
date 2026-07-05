import "server-only";
import type { BrandBookTemplate, CanvasTokens } from "../types";
import {
  renderColorSection,
  renderCtaSection,
  renderDocumentShell,
  renderFooterSection,
  renderHero,
  renderLogoSection,
  renderStory,
  renderTypographySection,
  renderVoiceSection,
} from "../shared";

// Dark canvas, gradient-forward, high contrast: the closest match to the
// Mogul reference's own energy. Chrome is fixed neutrals; the brand's own
// primary/secondary/accent hues are what's actually on display.
const CANVAS: CanvasTokens = {
  background: "#0B0B0F",
  surface: "#17171B",
  border: "#2A2A30",
  heading: "#F5F5F7",
  body: "#D4D4D9",
  muted: "#8A8A94",
};

const RADIUS = "20px";

const EXTRA_CSS = `
.bb-hero{position:relative;}
.bb-hero::before{content:"";position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:900px;height:520px;background:radial-gradient(closest-side, rgba(255,255,255,0.06), transparent 70%);pointer-events:none;z-index:0;}
.bb-hero *{position:relative;z-index:1;}
.bb-swatch,.bb-pillar,.bb-logo-tile{box-shadow:0 1px 0 rgba(255,255,255,0.05) inset;}
`;

export const boldSpectrum: BrandBookTemplate = {
  id: "bold_spectrum",
  label: "Bold Spectrum",
  description: "Dark canvas, gradient accents, high-contrast type. A designed brand deck.",
  render(args) {
    const bodyInner = [
      renderHero(args, CANVAS),
      renderStory(args),
      renderLogoSection(args, CANVAS),
      renderColorSection(args),
      renderTypographySection(args),
      renderVoiceSection(args),
      renderCtaSection(args),
      renderFooterSection(args),
    ]
      .filter(Boolean)
      .join("");

    return renderDocumentShell({
      title: `${args.brandName} Brand Guidelines`,
      canvas: CANVAS,
      tokens: args.tokens,
      radius: RADIUS,
      extraCss: EXTRA_CSS,
      bodyInner,
    });
  },
};
