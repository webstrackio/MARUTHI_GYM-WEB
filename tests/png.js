// A minimal PNG decoder, used only by the tests.
//
// It exists so the card can be verified by looking at the actual pixels: a
// rasteriser that silently drops text still produces a perfectly valid PNG, so
// "the render did not throw" proves nothing. Decoding the pixels lets a test
// assert that white glyphs and the green accent really are on the image, which
// is the only way to prove the visual receipt is not an empty blue rectangle.
//
// Handles the exact subset resvg emits: 8-bit RGBA, non-interlaced, and all five
// scanline filters.

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodes a PNG buffer to { width, height, data } where data is RGBA bytes. */
export function decodePng(buffer) {
  const bytes = Buffer.from(buffer);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("Not a PNG (bad signature)");
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = bytes.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip CRC
  }

  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  if (colorType !== 6) throw new Error(`Unsupported colour type ${colorType} (expected 6 = RGBA)`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");

  const raw = inflateSync(Buffer.concat(idat));
  const channels = 4;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const lineStart = y * (stride + 1) + 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[lineStart + x];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= channels && y > 0 ? out[prevStart + x - channels] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + a; break;
        case 2: restored = value + b; break;
        case 3: restored = value + ((a + b) >> 1); break;
        case 4: restored = value + paeth(a, b, c); break;
        default: throw new Error(`Unknown scanline filter ${filter}`);
      }
      out[rowStart + x] = restored & 0xff;
    }
  }

  return { width, height, data: out };
}

/** Counts pixels matching a predicate over their [r,g,b] triple. */
export function countPixels(png, predicate) {
  const { data } = png;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (predicate(data[i], data[i + 1], data[i + 2], data[i + 3])) {
      count++;
    }
  }
  return count;
}

/** True for near-white pixels - the card's title and value text. */
export const isWhite = (r, g, b) => r > 225 && g > 225 && b > 225;

/** True for the card's navy background range. */
export const isNavy = (r, g, b) => r < 60 && g < 80 && b > 90 && b < 190;

/** True for the success green (#22c55e and its low-opacity blends). */
export const isGreen = (r, g, b) => g > 110 && g > r + 40 && g > b + 30;
