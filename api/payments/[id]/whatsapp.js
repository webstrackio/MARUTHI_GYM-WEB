import { storage } from "../../../server/lib/storage.js";
import { deliverPaymentReceipt, getWhatsAppConfig } from "../../../server/lib/whatsapp.js";

// Vercel exposes dynamic segments through `req.query`; the local Express server
// uses `req.params`. Support both so one handler serves both deployments.
function paymentIdFrom(req) {
  const raw = req.query?.id ?? req.params?.id;
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The owner-driven resend, kept alongside the automatic trigger so a receipt can
// always be re-delivered: the number was wrong, the template was unapproved at
// the time, or the first attempt failed. It bypasses the already-sent guard
// because a deliberate resend is meant to send again.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = paymentIdFrom(req);
  if (id === null) {
    return res.status(400).json({ error: "Valid payment id is required" });
  }

  const payment = await storage.getPaymentById(id);
  if (!payment) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const result = await deliverPaymentReceipt(id, { storage, force: true });

  if (result.ok) {
    return res.json({ ok: true, status: result.status, messageId: result.messageId ?? null, to: result.to ?? null });
  }
  // 502 for a Meta-side failure, 409 for a state conflict, 422 for something we
  // can describe precisely (no number, not configured). The client turns any
  // non-ok result into a readable toast with `error`.
  const status = result.status === "failed" ? 502 : 409;
  return res.status(status).json({
    ok: false,
    status: result.status,
    error: result.error || "Could not send the receipt",
    to: result.to ?? null,
    configured: getWhatsAppConfig().configured,
  });
}
