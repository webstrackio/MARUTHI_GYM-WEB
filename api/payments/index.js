import { storage } from "../../server/lib/storage.js";
import { insertPaymentSchema } from "../../shared/schema.js";
import { addCalendarMonths, toDateInputValue } from "../../shared/dates.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payments = await storage.getPayments();
      res.json(payments);
    } catch (error) {
      console.error("GET /api/payments failed:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  } else if (req.method === "POST") {
    try {
      const tokenNumber = `TKN-${Date.now()}`;
      const durationMonths = Number(req.body.duration);
      if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
        return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
      }
      const student = await storage.getStudentById(req.body.studentId);
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }
      const baseDate =
        student.expiryDate && new Date(student.expiryDate) > new Date(req.body.date)
          ? new Date(student.expiryDate)
          : new Date(req.body.date);
      const expiryDate = toDateInputValue(addCalendarMonths(baseDate, durationMonths));
      const validatedData = insertPaymentSchema.parse({
        ...req.body,
        duration: durationMonths,
        startDate: req.body.startDate || req.body.date,
        expiryDate,
        tokenNumber,
      });
      const payment = await storage.createPayment(validatedData);
      await storage.updateStudent(validatedData.studentId, { expiryDate });
      res.status(201).json(payment);
    } catch (error) {
      if (error.name === "ZodError") {
        console.error("POST /api/payments validation failed:", error.errors);
        return res.status(400).json({ error: "Invalid payment data", details: error.errors });
      }
      console.error("POST /api/payments failed:", error);
      res.status(500).json({ error: "Failed to create payment" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
