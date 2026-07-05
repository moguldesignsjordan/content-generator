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

// Light canvas, restrained, editorial. Same sections and data as Bold
// Spectrum, just a quieter, more corporate-friendly treatment.
const CANVAS: CanvasTokens = {
  background: "#FFFFFF",
  surface: "#F6F6F7",
  border: "#E7E7EA",
  heading: "#101012",
  body: "#3A3A40",
  muted: "#767680",
};

const RADIUS = "8px";

const EXTRA_CSS = `
.bb-swatch{box-shadow:0 1px 2px rgba(0,0,0,0.05);}
.bb-logo-tile{box-shadow:0 1px 2px rgba(0,0,0,0.05);}
.bb-gradient{height:6px;}
`;

export const cleanMinimal: BrandBookTemplate = {
  id: "clean_minimal",
  label: "Clean Minimal",
  description: "Light canvas, generous whitespace, editorial feel.",
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
