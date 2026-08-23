import { storage } from "../../server/lib/storage.js";

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "PATCH") {
    try {
      const payment = await storage.getPaymentById(parseInt(id));
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      const updatedPayment = await storage.updatePayment(parseInt(id), req.body);
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
      res.status(204).send();
    } catch (error) {
      console.error(`DELETE /api/payments/${id} failed:`, error);
      res.status(500).json({ error: "Failed to delete payment" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
