import { storage } from "../../server/lib/storage.js";

// Vercel's file-based functions expose dynamic route segments through
// `req.query` (e.g. req.query.id), not `req.params` which is an Express
// concept. Support both so the same handler works on Vercel and in the
// local Express server.
function paymentIdFrom(req) {
  const raw = req.query?.id ?? req.params?.id;
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default async function handler(req, res) {
  const id = paymentIdFrom(req);

  if (req.method === "PATCH") {
    try {
      if (id === null) {
        return res.status(400).json({ error: "Valid payment id is required" });
      }
      const payment = await storage.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      const allowedFields = {};
      if (req.body.date !== undefined) allowedFields.date = req.body.date;
      if (req.body.amount !== undefined) allowedFields.amount = req.body.amount;
      if (req.body.paymentMethod !== undefined) allowedFields.paymentMethod = req.body.paymentMethod;
      if (req.body.duration !== undefined) {
        const durationMonths = Number(req.body.duration);
        if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
          return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
        }
        allowedFields.duration = durationMonths;
      }
      // createdAt (payment time), tokenNumber and id are written once when the
      // payment is created and are never updatable, so the saved payment
      // timestamp can never change on edit.
      if (Object.keys(allowedFields).length === 0) {
        return res.json(payment);
      }
      const updatedPayment = await storage.updatePayment(id, allowedFields);
      await storage.recomputeStudentExpiry(updatedPayment.studentId);
      res.json(updatedPayment);
    } catch (error) {
      console.error(`PATCH /api/payments/${id} failed:`, error);
      res.status(500).json({ error: error.message || "Failed to update payment" });
    }
  } else if (req.method === "DELETE") {
    try {
      if (id === null) {
        return res.status(400).json({ error: "Valid payment id is required" });
      }
      const payment = await storage.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      await storage.deletePayment(id);
      await storage.recomputeStudentExpiry(payment.studentId);
      res.status(204).send();
    } catch (error) {
      console.error(`DELETE /api/payments/${id} failed:`, error);
      res.status(500).json({ error: error.message || "Failed to delete payment" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
