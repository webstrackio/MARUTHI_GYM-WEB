import { storage } from "../../server/lib/storage.js";
import { insertPaymentSchema } from "../../shared/schema.js";
import { calcExpiryDate, isDateString } from "../../shared/dates.js";
import { deliverPaymentReceipt } from "../../server/lib/whatsapp.js";
import { randomUUID } from "node:crypto";

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
      const manualExpiryDate = isDateString(req.body.expiryDate) ? req.body.expiryDate : null;
      const expiryDate = manualExpiryDate ?? calcExpiryDate(baseDate, durationMonths);
      const validatedData = insertPaymentSchema.parse({
        ...req.body,
        duration: durationMonths,
        startDate: req.body.startDate || req.body.date,
        expiryDate,
        tokenNumber,
      });
      // The card token is generated here, not taken from the request, and is
      // added after Zod has stripped the body. The public card URL is keyed on
      // this unguessable value rather than the sequential payment id, so nobody
      // can walk /api/whatsapp/card/1, /2, /3 and read students' receipts.
      const payment = await storage.createPayment({
        ...validatedData,
        whatsappCardToken: randomUUID(),
      });
      await storage.updateStudent(validatedData.studentId, { expiryDate });
      res.status(201).json(payment);
      // The payment is saved and the client already has its 201, so the receipt
      // goes out after the response. Two things follow from that ordering:
      //   - a WhatsApp failure can no longer change the payment's outcome, and
      //   - the owner is not kept waiting on Meta to see "Payment recorded".
      // On Vercel the handler still awaits the send, because a serverless
      // instance is frozen the moment it returns and the request would be
      // dropped mid-flight.
      //
      // This has its own catch on purpose. deliverPaymentReceipt already never
      // throws, but if it ever did, the error would land in the route's catch
      // below, which would try to send a second response on top of the 201 and
      // blow up with ERR_HTTP_HEADERS_SENT - turning a receipt problem into a
      // broken payment request.
      try {
        await deliverPaymentReceipt(payment.id, { storage });
      } catch (receiptError) {
        console.error(`[whatsapp] unexpected error sending receipt for payment ${payment.id}:`, receiptError);
      }
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
