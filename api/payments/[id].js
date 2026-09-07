import { storage } from "../../server/lib/storage.js";

export default async function handler(req, res) {
  const id = parseInt(req.params.id, 10);

  if (req.method === "PATCH") {
    try {
      const payment = await storage.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      if (req.body.duration !== undefined) {
        const durationMonths = Number(req.body.duration);
        if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
          return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
        }
      }
      const updatedPayment = await storage.updatePayment(id, req.body);
      await storage.recomputeStudentExpiry(updatedPayment.studentId);
      res.json(updatedPayment);
    } catch (error) {
      console.error(`PATCH /api/payments/${id} failed:`, error);
      res.status(500).json({ error: "Failed to update payment" });
    }
  } else if (req.method === "DELETE") {
    try {
      const payment = await storage.getPaymentById(parseInt(id));
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      await storage.deletePayment(parseInt(id));
      await storage.recomputeStudentExpiry(payment.studentId);
      res.status(204).send();
    } catch (error) {
      console.error(`DELETE /api/payments/${id} failed:`, error);
      res.status(500).json({ error: "Failed to delete payment" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
