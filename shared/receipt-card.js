// Builds the payment receipt as an SVG image.
//
// WhatsApp text messages render inside WhatsApp's own bubble with no control
// over colour, so a "blue card" is only possible as an image. This module is the
// design: a pure function from receipt data to an SVG string, with no native
// dependency and no I/O, so the whole layout is testable by string assertions.
// server/lib/card-renderer.js turns the SVG into a PNG.
//
// Everything visual is defined here - colours, spacing, the gradient - so the
// card can be restyled without touching the sender.

const CARD_WIDTH = 720;
const PADDING = 40;

// Palette. Deep navy so white text stays legible in WhatsApp's light and dark
// chat themes, with a green success accent that matches the on-site card.
const COLORS = {
  gradientTop: "#0b1f45",
  gradientMid: "#1e3a8a",
  gradientBottom: "#0f2557",
  title: "#ffffff",
  label: "#93c5fd",
  value: "#ffffff",
  divider: "#2b4a8f",
  success: "#22c55e",
  successDim: "#14532d",
  muted: "#bfdbfe",
};

// Escapes the five XML metacharacters. Student names are free text from the
// database, so an unescaped "&" or "<" would produce invalid SVG that resvg
// rejects - and, before that, an injection vector into the markup.
export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Rough advance width per character for a sans-serif face, as a fraction of the
// font size. Used only to decide where to clip a long name; a wrong estimate
// costs a few characters of a name, never a broken render.
const AVG_CHAR_WIDTH = 0.56;
const AVERAGE_SANS_FALLBACK = 0.55;

// Clips a value to fit `maxWidth` px at `fontSize`, appending an ellipsis.
// Without this a long name would run past the card edge.
export function fitText(value, maxWidth, fontSize, avgCharWidth = AVG_CHAR_WIDTH) {
  const text = String(value ?? "");
  const perChar = fontSize * avgCharWidth;
  if (perChar <= 0) {
    return text;
  }
  const maxChars = Math.floor(maxWidth / perChar);
  if (maxChars <= 1) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

// Wraps a value across at most `maxLines` lines of `maxWidth` px, breaking on
// spaces so a name splits at a word boundary instead of mid-word.
export function wrapText(value, maxWidth, fontSize, maxLines = 2, avgCharWidth = AVG_CHAR_WIDTH) {
  const text = String(value ?? "").trim();
  if (!text) {
    return [];
  }
  const perChar = fontSize * avgCharWidth;
  const maxChars = Math.max(1, Math.floor(maxWidth / perChar));
  if (text.length <= maxChars) {
    return [text];
  }
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    // A single word longer than the line has to be hard-split.
    current = candidate.length > maxChars && !current ? word.slice(0, maxChars) : word;
    if (lines.length === maxLines) {
      break;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }
  const clamped = lines.slice(0, maxLines);
  if (lines.length > maxLines || clamped.at(-1)?.length >= maxChars) {
    clamped[clamped.length - 1] = fitText(clamped.at(-1) ?? "", maxWidth, fontSize, avgCharWidth);
  }
  return clamped.filter(Boolean);
}

function textNode({ x, y, value, size, fill, weight = "400", anchor = "start", letterSpacing = 0, opacity = 1 }) {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-size="${size}"`,
    `fill="${fill}"`,
    `font-weight="${weight}"`,
    `text-anchor="${anchor}"`,
  ];
  if (letterSpacing) attrs.push(`letter-spacing="${letterSpacing}"`);
  if (opacity !== 1) attrs.push(`opacity="${opacity}"`);
  return `<text ${attrs.join(" ")}>${escapeXml(value)}</text>`;
}

// A tick drawn as a path rather than the "✓" glyph. Glyph coverage for U+2713
// varies by font and a missing glyph renders as an empty box on a customer's
// receipt; a path is guaranteed.
function checkMark(cx, cy, size, color, strokeWidth) {
  const s = size / 2;
  return `<path d="M ${cx - s} ${cy} L ${cx - s * 0.25} ${cy + s * 0.72} L ${cx + s} ${cy - s * 0.78}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const LABEL_FONT_SIZE = 21;
const VALUE_FONT_SIZE = 23;
const LABEL_ROW_HEIGHT = 48;
// Labels hug the left gutter, values hug the right. Sharing one x for both drew
// the value straight on top of its own label, which rendered as unreadable
// overstruck text rather than a label/value pair.
const LABEL_VALUE_X = PADDING;
const LABEL_ROW_MAX_WIDTH = CARD_WIDTH - PADDING * 2;

// The detail rows, in display order. Kept as data so the SVG, the tests and the
// template-order test all read the same list.
export const CARD_ROWS = [
  { key: "studentName", label: "Name" },
  { key: "paymentDate", label: "Date" },
  { key: "expiryDate", label: "Expiry" },
  { key: "paymentTime", label: "Time" },
  { key: "daysLeftText", label: "Days Left" },
  { key: "status", label: "Status" },
];

// Works out every vertical position on the card before anything is drawn.
//
// The height cannot be a constant, because the detail block grows with a wrapped
// student name. Computing the geometry first and then drawing to it is what keeps
// a long name from running off the bottom. Exported so the tests can measure the
// card in the same coordinates the renderer used, instead of guessing.
export function layoutReceiptCard(data, options = {}) {
  const contentWidth = options.contentWidth ?? LABEL_ROW_MAX_WIDTH;
  const nameLines = wrapText(data.studentName, contentWidth, VALUE_FONT_SIZE, 2);
  const rowCount = CARD_ROWS.length - 1 + nameLines.length; // Name occupies nameLines
  const detailTop = 300;
  const detailsHeight = rowCount * LABEL_ROW_HEIGHT;
  const dividerY = detailTop + detailsHeight + 28;
  // The amount is the largest type on the card, so the pill is placed relative to
  // its baseline rather than to the divider. Deriving the pill from the divider
  // instead put it 4px under a 44px-tall amount, and the descender of a digit like
  // "9" cut into the top of the pill's rounded border.
  const amountY = dividerY + 84;
  const statusPillY = amountY + 26;
  const footerY = statusPillY + 78;
  const signoffY = footerY + 40;
  return {
    width: CARD_WIDTH,
    padding: PADDING,
    contentWidth,
    nameLines,
    rowCount,
    detailTop,
    detailsHeight,
    dividerY,
    amountY,
    statusPillY,
    footerY,
    signoffY,
    height: signoffY + 56,
  };
}

// Renders the full receipt card as an SVG string.
// `data` is the object from buildReceiptData() in shared/whatsapp-receipt.js.
export function buildReceiptSvg(data, options = {}) {
  const fontFamily = options.fontFamily || "DejaVu Sans, Noto Sans, Verdana, Arial, sans-serif";
  const contentWidth = options.contentWidth ?? LABEL_ROW_MAX_WIDTH;
  const L = layoutReceiptCard(data, { contentWidth });
  const { width: CARD_WIDTH_W, height, detailTop, dividerY, statusPillY, footerY, signoffY, nameLines } = L;
  const { amountY } = L;
  const width = CARD_WIDTH_W;
  const labelRowHeight = LABEL_ROW_HEIGHT;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(fontFamily)}">`,
  );
  parts.push("<defs>");
  parts.push(
    `<linearGradient id="cardBg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0%" stop-color="${COLORS.gradientTop}"/><stop offset="55%" stop-color="${COLORS.gradientMid}"/><stop offset="100%" stop-color="${COLORS.gradientBottom}"/></linearGradient>`,
  );
  parts.push(`<clipPath id="cardClip"><rect width="${width}" height="${height}" rx="28" ry="28"/></clipPath>`);
  parts.push("</defs>");
  parts.push(`<g clip-path="url(#cardClip)">`);
  parts.push(`<rect width="${width}" height="${height}" fill="url(#cardBg)"/>`);
  // A soft highlight behind the title, so the top of the card is not flat.
  parts.push(
    `<ellipse cx="${width / 2}" cy="60" rx="300" ry="150" fill="${COLORS.gradientMid}" opacity="0.35"/>`,
  );

  // --- Success badge -----------------------------------------------------
  const badgeCx = width / 2;
  parts.push(`<circle cx="${badgeCx}" cy="86" r="30" fill="${COLORS.success}" opacity="0.16"/>`);
  parts.push(`<circle cx="${badgeCx}" cy="86" r="22" fill="${COLORS.success}"/>`);
  parts.push(checkMark(badgeCx, 86, 24, "#ffffff", 4));
  parts.push(
    textNode({
      x: badgeCx,
      y: 148,
      value: "PAYMENT SUCCESSFUL",
      size: 22,
      fill: COLORS.success,
      weight: "700",
      anchor: "middle",
      letterSpacing: 2.5,
    }),
  );

  // --- Title -------------------------------------------------------------
  parts.push(
    textNode({
      x: badgeCx,
      y: 214,
      value: String(data.gymName || "Maruthi Gym").toUpperCase(),
      size: 46,
      fill: COLORS.title,
      weight: "700",
      anchor: "middle",
      letterSpacing: 1.5,
    }),
  );
  parts.push(
    `<rect x="${badgeCx - 46}" y="238" width="92" height="4" rx="2" fill="${COLORS.success}" opacity="0.9"/>`,
  );

  // --- Detail rows -------------------------------------------------------
  // Two columns: the label sits in the left gutter and its value is anchored to
  // the right edge, so the two never collide no matter how long either gets.
  const valueX = width - PADDING;
  let y = detailTop;
  for (const row of CARD_ROWS) {
    parts.push(
      textNode({
        x: LABEL_VALUE_X,
        y,
        value: row.label,
        size: LABEL_FONT_SIZE,
        fill: COLORS.label,
        weight: "500",
      }),
    );
    if (row.key === "studentName") {
      nameLines.forEach((line, index) => {
        parts.push(
          textNode({
            x: valueX,
            y: y + index * (VALUE_FONT_SIZE + 8),
            value: line,
            size: VALUE_FONT_SIZE,
            fill: COLORS.value,
            weight: "600",
            anchor: "end",
          }),
        );
      });
      y += (nameLines.length - 1) * (VALUE_FONT_SIZE + 8);
    } else {
      parts.push(
        textNode({
          x: valueX,
          y,
          value: fitText(String(data[row.key] ?? ""), contentWidth, VALUE_FONT_SIZE),
          size: VALUE_FONT_SIZE,
          fill: COLORS.value,
          weight: "600",
          anchor: "end",
        }),
      );
    }
    y += labelRowHeight;
  }

  // --- Amount ------------------------------------------------------------
  parts.push(`<rect x="${PADDING}" y="${dividerY}" width="${contentWidth}" height="2" fill="${COLORS.divider}"/>`);
  parts.push(
    textNode({
      x: LABEL_VALUE_X,
      y: dividerY + 48,
      value: "Amount Paid",
      size: 24,
      fill: COLORS.label,
      weight: "500",
    }),
  );
  parts.push(
    textNode({
      x: width - PADDING,
      y: L.amountY,
      value: String(data.amount ?? ""),
      size: 54,
      fill: COLORS.title,
      weight: "700",
      anchor: "end",
    }),
  );

  // --- Payment status pill ----------------------------------------------
  const pillWidth = 250;
  const pillX = (width - pillWidth) / 2;
  parts.push(
    `<rect x="${pillX}" y="${statusPillY}" width="${pillWidth}" height="52" rx="26" fill="${COLORS.success}" opacity="0.14" stroke="${COLORS.success}" stroke-width="2"/>`,
  );
  parts.push(
    textNode({
      x: width / 2,
      y: statusPillY + 35,
      value: `PAYMENT STATUS: ${data.paymentStatus ?? "PAID"}`,
      size: 23,
      fill: COLORS.success,
      weight: "700",
      anchor: "middle",
      letterSpacing: 1,
    }),
  );

  // --- Footer ------------------------------------------------------------
  parts.push(
    textNode({
      x: width / 2,
      y: footerY,
      value: "Thank you for your payment!",
      size: 24,
      fill: COLORS.muted,
      weight: "500",
      anchor: "middle",
    }),
  );
  parts.push(
    textNode({
      x: width / 2,
      y: signoffY,
      value: `— ${data.gymName || "Maruthi Gym"}`,
      size: 21,
      fill: COLORS.label,
      weight: "400",
      anchor: "middle",
    }),
  );

  parts.push("</g></svg>");
  return parts.join("");
}
