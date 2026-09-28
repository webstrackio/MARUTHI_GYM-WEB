import { describe, expect, it } from "vitest";
import { buildReceiptSvg, escapeXml, fitText, wrapText, layoutReceiptCard, CARD_ROWS } from "../shared/receipt-card.js";
import { buildReceiptData } from "../shared/whatsapp-receipt.js";
import { renderCardPng } from "../server/lib/card-renderer.js";
import { countPixels, decodePng, isGreen, isNavy, isWhite } from "./png.js";
import { makePayment, makeStudent } from "./helpers.js";

const NOW = new Date("2026-09-28T00:00:00");

function receiptData(overrides = {}) {
  return buildReceiptData(makePayment(overrides.payment), makeStudent(overrides.student), {
    now: NOW,
    gymName: "Maruthi Gym",
  });
}

describe("escapeXml", () => {
  it("escapes every character that could break the markup", () => {
    expect(escapeXml(`R&D <script>"x" 'y'`)).toBe("R&amp;D &lt;script&gt;&quot;x&quot; &apos;y&apos;");
  });

  it("turns a hostile student name into inert text", () => {
    const svg = buildReceiptSvg(receiptData({ payment: { studentName: '<img src=x onerror="alert(1)">' } }));
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;img");
  });
});

describe("fitText / wrapText", () => {
  it("leaves a value that already fits alone", () => {
    expect(fitText("R. Vijay Krishna", 400, 23)).toBe("R. Vijay Krishna");
  });

  it("clips a value that is too wide", () => {
    const fitted = fitText("A".repeat(200), 100, 23);
    expect(fitted.length).toBeLessThan(10);
    expect(fitted.endsWith("…")).toBe(true);
  });

  it("wraps a long name on a word boundary", () => {
    const lines = wrapText("R Vijay Krishna Maruthi", 120, 23, 2);
    expect(lines).toEqual(["R Vijay", "Krishna"]);
  });

  it("returns a single line when it fits", () => {
    expect(wrapText("Vijay", 400, 23, 2)).toEqual(["Vijay"]);
  });
});

describe("buildReceiptSvg", () => {
  const svg = buildReceiptSvg(receiptData());

  it("is a well-formed SVG with a viewBox", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 720 \d+"/);
  });

  it("uses the dark-blue card background, not white", () => {
    expect(svg).toContain('id="cardBg"');
    expect(svg).toContain("#0b1f45");
    expect(svg).toContain("#1e3a8a");
    // Rounded card corners, matching the on-site card.
    expect(svg).toContain('rx="28"');
  });

  it("puts the gym name at the top as the title", () => {
    expect(svg).toContain("MARUTHI GYM");
  });

  it("includes the green success indicator and the success wording", () => {
    expect(svg).toContain("#22c55e");
    expect(svg).toContain("PAYMENT SUCCESSFUL");
  });

  it("draws the tick as a path so it does not depend on font glyph coverage", () => {
    expect(svg).toContain("stroke-linecap=\"round\"");
    expect(svg).not.toContain("✓");
  });

  it.each([
    ["student name", "R. Vijay Krishna"],
    ["payment date", "09/09/2026"],
    ["expiry date", "09/10/2026"],
    ["payment time", "4:41 PM"],
    ["days left", "11 days"],
    ["membership status", "ACTIVE"],
    ["amount", "₹ 1,500"],
  ])("includes the %s", (_field, expected) => {
    expect(svg).toContain(escapeXml(expected));
  });

  it("includes the payment status", () => {
    expect(svg).toContain("PAYMENT STATUS: PAID");
  });

  it("labels every detail row", () => {
    for (const row of CARD_ROWS) {
      expect(svg).toContain(escapeXml(row.label));
    }
  });

  it("shows EXPIRED for a lapsed membership", () => {
    const lapsed = buildReceiptSvg(receiptData({ payment: { expiryDate: "2026-09-01" } }));
    expect(lapsed).toContain("EXPIRED");
  });

  it("grows taller for a long name so nothing is clipped", () => {
    const short = buildReceiptSvg(receiptData());
    const long = buildReceiptSvg(
      receiptData({ payment: { studentName: "Rama Krishna Maruthi Venkateswara Murthy Bhavana Ramesh" } }),
    );
    const heightOf = (s) => Number(s.match(/height="(\d+)"/)[1]);
    expect(heightOf(long)).toBeGreaterThan(heightOf(short));
  });

  it("reports geometry consistent with what it drew", () => {
    const data = receiptData();
    const layout = layoutReceiptCard(data);
    expect(layout.nameLines).toEqual(["R. Vijay Krishna"]);
    expect(layout.rowCount).toBe(CARD_ROWS.length);
    // Everything must fit inside the canvas it declares.
    expect(layout.signoffY).toBeLessThan(layout.height);
    expect(layout.dividerY).toBeLessThan(layout.statusPillY);
  });

  it("counts an extra row height when the name wraps onto two lines", () => {
    const oneLine = layoutReceiptCard(receiptData());
    const twoLines = layoutReceiptCard(
      receiptData({ payment: { studentName: "Rama Krishna Maruthi Venkateswara Murthy Bhavana Ramesh" } }),
    );
    expect(twoLines.nameLines).toHaveLength(2);
    expect(twoLines.height).toBeGreaterThan(oneLine.height);
  });

  it("leaves room for the amount's descenders before the status pill starts", () => {
    // The amount is 54px type and the pill is a 52px rounded border. Placing the
    // pill off the divider instead of off the amount's baseline tucked its top
    // edge 4px under a digit's descender, so the two shapes touched.
    const layout = layoutReceiptCard(receiptData());
    expect(layout.amountY).toBeGreaterThan(layout.dividerY);
    expect(layout.statusPillY - layout.amountY).toBeGreaterThanOrEqual(20);
  });
});

describe("detail rows keep the label and the value apart", () => {
  // Regression guard. The label and its value used to be drawn at the same x and
  // the same y, so every row rendered as overstruck, unreadable text. The SVG
  // string is parsed rather than the PNG because the assertion is about intent:
  // the two must be on opposite sides of the card, not merely "somewhere".
  const rowNodes = (svg) =>
    [...svg.matchAll(/<text[^>]*x="(\d+)"[^>]*y="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      text: m[3],
      anchor: /text-anchor="end"/.test(m[0]) ? "end" : "start",
    }));

  it("puts every detail label on the left and its value on the right", () => {
    const nodes = rowNodes(buildReceiptSvg(receiptData()));
    const left = nodes.filter((n) => n.anchor === "start");
    const right = nodes.filter((n) => n.anchor === "end");

    expect(left.map((n) => n.text)).toEqual(expect.arrayContaining(CARD_ROWS.map((r) => r.label)));
    // Label and value share a baseline by design, so the assertion is about x:
    // a right-anchored value must never sit at the label's x, which is what
    // overstruck them into unreadability in the first place.
    for (const value of right) {
      for (const label of left) {
        if (label.y !== value.y) continue;
        expect(value.x).toBeGreaterThan(label.x + 100);
      }
    }
  });

  it("keeps labels and values at opposite edges of the content area", () => {
    const nodes = rowNodes(buildReceiptSvg(receiptData()));
    const label = nodes.find((n) => n.text === "Name");
    const nameValue = nodes.find((n) => n.text === "R. Vijay Krishna");
    expect(label.x).toBe(40);
    // Anchored to the right gutter, so the value's own x is the card's right edge.
    expect(nameValue.x).toBe(680);
  });

  it("right-anchors every detail value so none can grow into its label", () => {
    const nodes = rowNodes(buildReceiptSvg(receiptData()));
    const values = nodes.filter((n) => n.anchor === "end");
    // With anchor=end a long value grows leftwards, toward the label, so the
    // label must be narrow and the value must be the one that can shrink.
    expect(values.length).toBeGreaterThanOrEqual(CARD_ROWS.length);
    for (const value of values) {
      expect(value.x).toBe(680);
    }
  });
});

describe("renderCardPng - the image is real", () => {
  it("produces a valid RGBA PNG of the expected size", async () => {
    const { png, width, height } = await renderCardPng(buildReceiptSvg(receiptData()), { width: 720 });
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(width).toBe(720);
    expect(height).toBeGreaterThan(500);
  });

  it("actually paints white glyphs, so the text really rendered", async () => {
    const { png } = await renderCardPng(buildReceiptSvg(receiptData()), { width: 720 });
    const decoded = decodePng(png);
    const whitePixels = countPixels(decoded, isWhite);
    // The title, six value rows, the amount and two footer lines. A rasteriser
    // that dropped its font would leave zero of these.
    expect(whitePixels).toBeGreaterThan(3000);
  });

  it("paints the navy card background", async () => {
    const { png } = await renderCardPng(buildReceiptSvg(receiptData()), { width: 720 });
    const navyPixels = countPixels(decodePng(png), isNavy);
    expect(navyPixels).toBeGreaterThan(200_000);
  });

  it("paints the green success accent", async () => {
    const { png } = await renderCardPng(buildReceiptSvg(receiptData()), { width: 720 });
    const greenPixels = countPixels(decodePng(png), isGreen);
    // Badge circle, tick, title underline, status pill.
    expect(greenPixels).toBeGreaterThan(2000);
  });

  it("renders materially more ink in the detail rows when the values are real", async () => {
    // The definitive check that the glyphs come from the data rather than being
    // painted from a placeholder: count white pixels ONLY inside the detail-row
    // band, which excludes the title, the amount and the footer. Those dominate
    // total ink and would otherwise mask the comparison.
    //
    // The baseline is not zero, and deliberately so. Days Left and Status are
    // derived from `now` and the expiry date rather than stored, so they render
    // as "0 days" and "EXPIRED" even when every stored field is blank. The
    // baseline is therefore the ink from those two derived rows alone, which is
    // exactly the floor this comparison should be read against.
    const bandInk = async (data, band) => {
      const layout = layoutReceiptCard(data);
      const { png, width } = await renderCardPng(buildReceiptSvg(data), { width: 720 });
      const decoded = decodePng(png);
      const scale = decoded.height / layout.height;
      const top = Math.max(0, Math.round(band.top(layout) * scale));
      const bottom = Math.round(band.bottom(layout) * scale);
      let count = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = 0; x < decoded.width; x++) {
          const i = (y * decoded.width + x) * 4;
          if (isWhite(decoded.data[i], decoded.data[i + 1], decoded.data[i + 2])) count++;
        }
      }
      return count;
    };

    const detailBand = { top: (l) => l.detailTop - 12, bottom: (l) => l.dividerY - 8 };
    const withValues = await bandInk(receiptData(), detailBand);
    const blank = buildReceiptData(
      { date: "", expiryDate: null, studentName: "", amount: 0, createdAt: null },
      { phone: "" },
      { now: NOW, gymName: "Maruthi Gym" },
    );
    const baseline = await bandInk(blank, detailBand);

    expect(withValues).toBeGreaterThan(4000);
    expect(withValues).toBeGreaterThan(baseline * 3);
  });

  it("draws the real amount, so a bigger payment produces more ink in the amount band", async () => {
    // Guards the "receipt shows the actual payment amount" requirement: the ink in
    // the amount band has to track the digits that were actually paid.
    const amountInk = async (amount) => {
      const data = receiptData({ payment: { amount } });
      const layout = layoutReceiptCard(data);
      const { png, width } = await renderCardPng(buildReceiptSvg(data), { width: 720 });
      const decoded = decodePng(png);
      const scale = decoded.height / layout.height;
      const top = Math.round((layout.dividerY + 40) * scale);
      const bottom = Math.round((layout.dividerY + 100) * scale);
      let count = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = 0; x < decoded.width; x++) {
          const i = (y * decoded.width + x) * 4;
          if (isWhite(decoded.data[i], decoded.data[i + 1], decoded.data[i + 2])) count++;
        }
      }
      return count;
    };

    const small = await amountInk(100);
    const large = await amountInk(100000);
    // ₹ 1,00,000 has more glyphs than ₹ 100.
    expect(large).toBeGreaterThan(small * 1.5);
  });

  it("rejects a render too small to be a real card, so the sender can fall back", async () => {
    // Proves the sender can tell "render failed" from "render produced nothing",
    // which is what lets it fall back to a text receipt instead of sending a
    // customer a 1px image.
    const svg = buildReceiptSvg(receiptData());
    await expect(renderCardPng(svg, { width: 1 })).rejects.toThrow(/suspiciously small/);
  });
});
