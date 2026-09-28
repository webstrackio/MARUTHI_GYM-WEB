// Rasterises the receipt SVG into a PNG for WhatsApp to display.
//
// WhatsApp cannot be handed an SVG, and it cannot be handed a data: URL either -
// a template's image header needs a publicly reachable HTTPS link. So the card is
// rendered here to PNG bytes and exposed through a public route (see
// api/whatsapp/card/[token].js), and that URL is what goes into the template.
//
// The rasteriser is resvg (Rust, prebuilt binaries, no system fontconfig or
// browser needed), loaded with a dynamic import so that a machine without the
// native binary degrades to a text-only receipt instead of failing the payment.

// Font families preferred for the card. resvg silently drops text whose font is
// missing, so the order matters: DejaVu and Noto ship with most Linux images and
// both cover the rupee sign (U+20B9) that the amount needs.
const PREFERRED_FONTS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/Library/Fonts/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\segoeui.ttf",
];

let resvgModulePromise = null;

async function loadResvg() {
  if (!resvgModulePromise) {
    resvgModulePromise = import("@resvg/resvg-js").then((m) => m.Resvg ?? null);
  }
  try {
    return await resvgModulePromise;
  } catch {
    // A missing or mismatched native binary must not take the process down.
    return null;
  }
}

// True when the card can be rendered as an image on this machine. The sender uses
// this to decide between an image-header template and a text-only one.
export async function isCardRenderingAvailable() {
  const Resvg = await loadResvg();
  return typeof Resvg === "function";
}

// Probes which of the preferred font files actually exist, so they can be passed
// to resvg explicitly instead of relying on fontconfig, which is not present in
// every serverless image.
async function findFontFiles(exists) {
  const found = [];
  for (const candidate of PREFERRED_FONTS) {
    if (await exists(candidate)) {
      found.push(candidate);
    }
  }
  return found;
}

/**
 * Renders an SVG string to PNG bytes.
 *
 * Throws when the rasteriser is unavailable or produces nothing usable, so the
 * caller can fall back to a text receipt instead of sending a blank card.
 * @returns {Promise<{ png: Buffer, width: number, height: number, fonts: string[] }>}
 */
export async function renderCardPng(svg, options = {}) {
  const Resvg = await loadResvg();
  if (typeof Resvg !== "function") {
    throw new Error("SVG rasteriser is not available on this platform");
  }

  const fontFiles = await findFontFiles(options.exists ?? defaultExists);
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: options.width ? { mode: "width", value: options.width } : undefined,
    font: {
      // Explicit files first, then whatever the platform offers, then the
      // family list baked into the SVG.
      fontFiles,
      loadSystemFonts: options.loadSystemFonts ?? true,
      defaultFontFamily: "DejaVu Sans",
    },
  });

  const image = resvg.render();
  const png = Buffer.from(image.asPng());
  const { width, height } = image;

  if (!png.length || png.length < 512) {
    throw new Error(`Rendered card is suspiciously small (${png.length} bytes)`);
  }

  return { png, width, height, fonts: fontFiles };
}

async function defaultExists(path) {
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Diagnostics for the status endpoint and for debugging a deployment where the
// card mysteriously comes out blank.
export async function getRendererInfo() {
  const available = await isCardRenderingAvailable();
  const fonts = available ? await findFontFiles(defaultExists) : [];
  return {
    available,
    fontCount: fonts.length,
    // Exposed so an operator can confirm the rupee sign and the card layout will
    // have a usable face. Paths only - no secrets involved.
    fonts,
  };
}

export const __testing = { findFontFiles, PREFERRED_FONTS };
