import { storage } from "../../../server/lib/storage.js";
import { buildReceiptSvg } from "../../../shared/receipt-card.js";
import { buildReceiptData } from "../../../shared/whatsapp-receipt.js";
import { getGymNameFromEnv } from "../../../server/lib/whatsapp.js";
import { renderCardPng } from "../../../server/lib/card-renderer.js";

// WhatsApp fetches this URL itself when it delivers a template whose header is an
// image, so the response has to be a real image and has to be reachable from the
// public internet.
//
// Access is keyed on the per-payment `whatsapp_card_token` (a UUID) rather than
// the payment id, so the URL cannot be guessed by counting. That is the only
// thing protecting this route, since the app has no authentication layer at all -
// see the security note in docs/whatsapp-receipts.md before adding more data to
// the card.
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel exposes dynamic segments on req.query; the token carries a ".png"
  // suffix, which lands in the last segment and has to be trimmed.
  const raw = req.query?.token ?? req.params?.token ?? "";
  const token = String(raw).replace(/\.png$/i, "").trim();
  if (!token) {
    return res.status(400).json({ error: "Card token is required" });
  }

  let payment;
  try {
    payment = await storage.getPaymentByCardToken(token);
  } catch (error) {
    console.error("[whatsapp/card] lookup failed:", error);
    return res.status(500).json({ error: "Could not load the receipt" });
  }
  if (!payment) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  let student = null;
  try {
    student = payment.studentId ? await storage.getStudentById(payment.studentId) : null;
  } catch {
    // The card only needs the payment row; the student lookup just supplies the
    // phone number, which the card does not display.
  }

  const data = buildReceiptData(payment, student, { gymName: getGymNameFromEnv() });

  try {
    const { png } = await renderCardPng(buildReceiptSvg(data), { width: 720 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    // Immutable: the URL is a one-off token, and the card for a given payment
    // never needs to change after the payment is recorded.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(png);
  } catch (error) {
    console.error("[whatsapp/card] render failed:", error);
    return res.status(500).json({ error: "Could not render the receipt card" });
  }
}
