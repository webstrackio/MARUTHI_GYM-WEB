import { storage } from "../../server/lib/storage.js";
import { insertPaymentSchema } from "../../shared/schema.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payments = await storage.getPayments();
      res.json(payments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  } else if (req.method === "POST") {
    try {
      const tokenNumber = `TKN-${Date.now()}`;
      const validatedData = insertPaymentSchema.parse({
        ...req.body,
        tokenNumber,
      });
      const payment = await storage.createPayment(validatedData);
      const student = await storage.getStudentById(validatedData.studentId);
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }
      const baseDate =
        student.expiryDate && new Date(student.expiryDate) > new Date(validatedData.date)
          ? new Date(student.expiryDate)
          : new Date(validatedData.date);
      const expiryDate = new Date(baseDate);
      expiryDate.setDate(expiryDate.getDate() + validatedData.duration);
      await storage.updateStudent(validatedData.studentId, {
        expiryDate: expiryDate.toISOString().split("T")[0],
      });
      res.status(201).json(payment);
    } catch (error) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid payment data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create payment" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
