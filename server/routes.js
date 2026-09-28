import { createServer } from "http";
import { randomUUID } from "node:crypto";
import { storage } from "./storage.js";
import { insertStudentSchema, insertPaymentSchema, normalizeBatch, normalizePhone } from "../shared/schema.js";
import { calcExpiryDate, daysUntil, isDateString, todayString } from "../shared/dates.js";
import { deliverPaymentReceipt, getWhatsAppConfig, getGymNameFromEnv } from "./lib/whatsapp.js";
import { buildReceiptSvg } from "../shared/receipt-card.js";
import { buildReceiptData } from "../shared/whatsapp-receipt.js";
import { renderCardPng, getRendererInfo } from "./lib/card-renderer.js";
export async function registerRoutes(app) {
    // WhatsApp configuration check. Reports only booleans and the names of
    // missing variables - never the access token or the phone number id.
    app.get("/api/whatsapp/status", async (_req, res) => {
        const config = getWhatsAppConfig();
        const renderer = await getRendererInfo();
        res.json({
            configured: config.configured,
            missing: config.missing,
            dryRun: config.dryRun,
            gymName: getGymNameFromEnv(),
            templateName: config.templateName,
            language: config.language,
            // Whether the blue card can be produced here, and whether Meta would
            // be able to fetch it. Both must be true for the image header to work.
            receiptStyle: config.receiptStyle,
            cardRendering: renderer.available,
            cardFontCount: renderer.fontCount,
            cardUrlConfigured: Boolean(config.publicBaseUrl),
        });
    });
    // The receipt card image. WhatsApp fetches this itself when delivering a
    // template with an image header. Keyed on an unguessable per-payment token
    // rather than the sequential payment id, so it cannot be walked.
    app.get("/api/whatsapp/card/:token.png", async (req, res) => {
        const token = String(req.params.token || "").replace(/\.png$/i, "").trim();
        if (!token) {
            return res.status(400).json({ error: "Card token is required" });
        }
        try {
            const payment = await storage.getPaymentByCardToken(token);
            if (!payment) {
                return res.status(404).json({ error: "Receipt not found" });
            }
            let student = null;
            try {
                student = payment.studentId ? await storage.getStudentById(payment.studentId) : null;
            }
            catch (_err) {
                // The card only needs the payment row; the student lookup just
                // supplies the phone number, which the card does not display.
            }
            const data = buildReceiptData(payment, student, { gymName: getGymNameFromEnv() });
            const { png } = await renderCardPng(buildReceiptSvg(data), { width: 720 });
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Content-Length", String(png.length));
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            return res.status(200).send(png);
        }
        catch (error) {
            console.error("[whatsapp/card] failed:", error);
            res.status(500).json({ error: "Could not render the receipt card" });
        }
    });
    // Dashboard stats
    app.get("/api/dashboard/stats", async (_req, res) => {
        try {
            const stats = await storage.getDashboardStats();
            res.json(stats);
        }
        catch (error) {
            console.error("GET /api/dashboard/stats failed:", error);
            res.status(500).json({ error: "Failed to fetch dashboard stats" });
        }
    });
    // Students endpoints
    app.get("/api/students", async (_req, res) => {
        try {
            const students = await storage.getStudents();
            res.json(students);
        }
        catch (error) {
            console.error("GET /api/students failed:", error);
            res.status(500).json({ error: "Failed to fetch students" });
        }
    });
    app.get("/api/students/next-register-no", async (_req, res) => {
        try {
            const nextRegisterNo = await storage.getNextRegisterNo();
            res.json({ nextRegisterNo });
        }
        catch (error) {
            console.error("GET /api/students/next-register-no failed:", error);
            res.status(500).json({ error: "Failed to fetch next register number" });
        }
    });
    app.get("/api/students/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const student = await storage.getStudentById(id);
            if (!student) {
                return res.status(404).json({ error: "Student not found" });
            }
            res.json(student);
        }
        catch (error) {
            console.error(`GET /api/students/${req.params.id} failed:`, error);
            res.status(500).json({ error: "Failed to fetch student" });
        }
    });
    app.post("/api/students", async (req, res) => {
        try {
            const normalizedPhone = normalizePhone(req.body.phone);
            if (!/^[0-9]{10}$/.test(normalizedPhone)) {
                return res.status(400).json({ error: "Phone number must be exactly 10 digits" });
            }
            // A phone number must be unique across the whole database, regardless
            // of batch or membership status.
            const existingPhone = await storage.getStudentByPhone(normalizedPhone);
            if (existingPhone) {
                return res.status(409).json({
                    error: "This phone number is already registered",
                    conflict: true,
                    student: existingPhone,
                });
            }
            // Register number is generated automatically from the backend to
            // guarantee it is numeric, sequential and unique.
            let registerNo = await storage.getNextRegisterNo();
            let existing = await storage.getStudentByRegisterNo(registerNo);
            while (existing) {
                registerNo = String(Number(registerNo) + 1);
                existing = await storage.getStudentByRegisterNo(registerNo);
            }
            if (!/^\d+$/.test(registerNo)) {
                return res.status(400).json({ error: "Register number must contain numbers only" });
            }
            const validatedData = insertStudentSchema.parse({
                ...req.body,
                phone: normalizedPhone,
                registerNo,
                batch: normalizeBatch(req.body.batch),
            });
            let student;
            try {
                student = await storage.createStudent(validatedData);
            }
            catch (error) {
                // Database unique constraint is the final protection against
                // race conditions where two requests insert the same phone at once.
                if (error && (error.code === "23505" || /unique/i.test(`${error.detail || ""}${error.message || ""}`))) {
                    const duplicate = await storage.getStudentByPhone(normalizedPhone);
                    return res.status(409).json({
                        error: "This phone number is already registered",
                        conflict: true,
                        student: duplicate,
                    });
                }
                throw error;
            }
            res.status(201).json(student);
        }
        catch (error) {
            if (error.name === "ZodError") {
                console.error("POST /api/students validation failed:", error.errors);
                return res.status(400).json({ error: "Invalid student data", details: error.errors });
            }
            console.error("POST /api/students failed:", error);
            res.status(500).json({ error: "Failed to create student" });
        }
    });
    app.patch("/api/students/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const student = await storage.getStudentById(id);
            if (!student) {
                return res.status(404).json({ error: "Student not found" });
            }
            const allowedFields = {};
            if (req.body.name !== undefined) allowedFields.name = req.body.name;
            if (req.body.phone !== undefined) {
                const normalizedPhone = normalizePhone(req.body.phone);
                if (!/^[0-9]{10}$/.test(normalizedPhone)) {
                    return res.status(400).json({ error: "Phone number must be exactly 10 digits" });
                }
                const duplicate = await storage.getStudentByPhone(normalizedPhone);
                if (duplicate && duplicate.id !== id) {
                    return res.status(409).json({
                        error: "This phone number is already registered",
                        conflict: true,
                        student: duplicate,
                    });
                }
                allowedFields.phone = normalizedPhone;
            }
            if (req.body.address !== undefined) allowedFields.address = req.body.address;
            if (req.body.joinDate !== undefined) allowedFields.joinDate = req.body.joinDate;
            if (req.body.expiryDate !== undefined) allowedFields.expiryDate = req.body.expiryDate;
            if (req.body.batch !== undefined) allowedFields.batch = normalizeBatch(req.body.batch);
            const updatedStudent = await storage.updateStudent(id, allowedFields);
            res.json(updatedStudent);
        }
        catch (error) {
            console.error(`PATCH /api/students/${req.params.id} failed:`, error);
            res.status(500).json({ error: "Failed to update student" });
        }
    });
    app.delete("/api/students/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const student = await storage.getStudentById(id);
            if (!student) {
                return res.status(404).json({ error: "Student not found" });
            }
            await storage.deleteStudent(id);
            res.status(204).send();
        }
        catch (error) {
            console.error(`DELETE /api/students/${req.params.id} failed:`, error);
            res.status(500).json({ error: "Failed to delete student" });
        }
    });
    // Payments endpoints
    app.get("/api/payments", async (_req, res) => {
        try {
            const payments = await storage.getPayments();
            res.json(payments);
        }
        catch (error) {
            console.error("GET /api/payments failed:", error);
            res.status(500).json({ error: "Failed to fetch payments" });
        }
    });
    app.post("/api/payments", async (req, res) => {
        try {
            const tokenNumber = `TKN-${Date.now()}`;
            // Duration is a whole number of calendar months (1, 2, 3, 6, 12 ...)
            const durationMonths = Number(req.body.duration);
            if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
                return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
            }
            const student = await storage.getStudentById(req.body.studentId);
            if (!student) {
                return res.status(404).json({ error: "Student not found" });
            }
            // Membership extends from the later of the current expiry or the
            // payment/start date, then adds whole calendar months.
            const baseDate = student.expiryDate && new Date(student.expiryDate) > new Date(req.body.date)
                ? new Date(student.expiryDate)
                : new Date(req.body.date);
            // A manually chosen expiry date (sent as YYYY-MM-DD) overrides the
            // automatic calculation when provided. Otherwise the automatic
            // calculation below is used, keeping existing behavior unchanged.
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
            // added after Zod has stripped the body. The public card URL is keyed
            // on this unguessable value rather than the sequential payment id, so
            // nobody can walk /api/whatsapp/card/1, /2, /3 and read students'
            // receipts.
            const payment = await storage.createPayment({
                ...validatedData,
                whatsappCardToken: randomUUID(),
            });
            await storage.updateStudent(validatedData.studentId, {
                expiryDate,
            });
            res.status(201).json(payment);
            // The payment is saved and the client already has its 201, so the
            // receipt goes out after the response. A WhatsApp failure can no
            // longer change the payment's outcome, and the owner is not kept
            // waiting on Meta to see "Payment recorded".
            //
            // The nested catch matters: without it, an unexpected throw from
            // deliverPaymentReceipt would be caught by the route's own catch
            // below, which would then try to write a second response on top of
            // the 201 and throw ERR_HTTP_HEADERS_SENT - turning a receipt
            // problem into a failed payment request.
            try {
                await deliverPaymentReceipt(payment.id, { storage });
            }
            catch (receiptError) {
                console.error(`[whatsapp] unexpected error sending receipt for payment ${payment.id}:`, receiptError);
            }
        }
        catch (error) {
            if (error.name === "ZodError") {
                console.error("POST /api/payments validation failed:", error.errors);
                return res.status(400).json({ error: "Invalid payment data", details: error.errors });
            }
            console.error("POST /api/payments failed:", error);
            res.status(500).json({ error: "Failed to create payment" });
        }
    });
    app.patch("/api/payments/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const payment = await storage.getPaymentById(id);
            if (!payment) {
                return res.status(404).json({ error: "Payment not found" });
            }
            const allowedFields = {};
            if (req.body.date !== undefined)
                allowedFields.date = req.body.date;
            if (req.body.amount !== undefined)
                allowedFields.amount = req.body.amount;
            if (req.body.paymentMethod !== undefined)
                allowedFields.paymentMethod = req.body.paymentMethod;
            if (req.body.duration !== undefined) {
                const durationMonths = Number(req.body.duration);
                if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
                    return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
                }
                allowedFields.duration = durationMonths;
            }
            // createdAt (payment time), tokenNumber and id are written once when
            // the payment is created and are never updatable, so the saved
            // payment timestamp can never change on edit.
            if (Object.keys(allowedFields).length === 0) {
                return res.json(payment);
            }
            const updatedPayment = await storage.updatePayment(id, allowedFields);
            await storage.recomputeStudentExpiry(updatedPayment.studentId);
            res.json(updatedPayment);
        }
        catch (error) {
            console.error(`PATCH /api/payments/${req.params.id} failed:`, error);
            res.status(500).json({ error: error.message || "Failed to update payment" });
        }
    });
    app.delete("/api/payments/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const payment = await storage.getPaymentById(id);
            if (!payment) {
                return res.status(404).json({ error: "Payment not found" });
            }
            await storage.deletePayment(id);
            await storage.recomputeStudentExpiry(payment.studentId);
            res.status(204).send();
        }
        catch (error) {
            console.error(`DELETE /api/payments/${req.params.id} failed:`, error);
            res.status(500).json({ error: error.message || "Failed to delete payment" });
        }
    });
    // Manual resend of a single receipt, mirroring api/payments/[id]/whatsapp.js.
    // `force` bypasses the already-sent guard because the owner explicitly asked
    // for the receipt to go out again.
    app.post("/api/payments/:id/whatsapp", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ error: "Valid payment id is required" });
            }
            const payment = await storage.getPaymentById(id);
            if (!payment) {
                return res.status(404).json({ error: "Payment not found" });
            }
            const result = await deliverPaymentReceipt(id, { storage, force: true });
            if (result.ok) {
                return res.json({
                    ok: true,
                    status: result.status,
                    messageId: result.messageId ?? null,
                    to: result.to ?? null,
                });
            }
            return res.status(result.status === "failed" ? 502 : 409).json({
                ok: false,
                status: result.status,
                error: result.error || "Could not send the receipt",
                to: result.to ?? null,
                configured: getWhatsAppConfig().configured,
            });
        }
        catch (error) {
            console.error(`POST /api/payments/${req.params.id}/whatsapp failed:`, error);
            res.status(500).json({ error: error.message || "Failed to send the receipt" });
        }
    });
    // Income stats
    app.get("/api/income/stats", async (_req, res) => {
        try {
            const stats = await storage.getIncomeStats();
            res.json(stats);
        }
        catch (error) {
            console.error("GET /api/income/stats failed:", error);
            res.status(500).json({ error: "Failed to fetch income stats" });
        }
    });
    app.get("/api/income/daily", async (req, res) => {
        try {
            const stats = await storage.getDailyIncome(req.query.date);
            res.json(stats);
        }
        catch (error) {
            console.error("GET /api/income/daily failed:", error);
            res.status(500).json({ error: "Failed to fetch daily income" });
        }
    });
    // Attendance endpoints
    app.get("/api/attendance", async (req, res) => {
        try {
            const date = req.query.date || todayString();
            const records = await storage.getAttendanceByDate(date);
            res.json(records);
        }
        catch (error) {
            console.error("GET /api/attendance failed:", error);
            res.status(500).json({ error: "Failed to fetch attendance records" });
        }
    });
    app.post("/api/attendance", async (req, res) => {
        try {
            // Accept registerNumber from attendance pad or registerNo from students dashboard
            const registerNumber = req.body.registerNumber || req.body.registerNo;
            if (!registerNumber || registerNumber === "") {
                return res.status(400).json({
                    type: "error",
                    message: "Register number is required",
                    student: null,
                    daysLeft: 0,
                    isExpired: false
                });
            }
            // Convert to string for database lookup
            const registerNoString = String(registerNumber).trim();
            // Step 1: Check if student exists
            const student = await storage.getStudentByRegisterNo(registerNoString);
            if (!student) {
                return res.status(404).json({
                    type: "error",
                    message: "Student not found",
                    student: null,
                    daysLeft: 0,
                    isExpired: false
                });
            }
            // Step 2: Calculate days left (calendar dates, never negative)
            const now = new Date();
            const daysLeft = Math.max(0, daysUntil(student.expiryDate));
            // Expired if: no expiry date OR days left <= 0
            const isExpired = !student.expiryDate || daysLeft <= 0;
            const today = todayString();
            // Saved payment timestamp from the database (written once when the
            // fee was paid) - never the current time.
            const latestPayment = await storage.getLatestPaymentByStudentId(student.id);
            const paymentDate = latestPayment?.date ?? null;
            const paymentTime = latestPayment?.createdAt ?? null;
            const studentInfo = {
                name: student.name,
                registerNumber: student.registerNo,
                expiryDate: student.expiryDate,
                joinDate: student.joinDate
            };
            // Step 3: Check if expired FIRST - don't insert for expired members
            if (isExpired) {
                return res.status(200).json({
                    type: "expired",
                    message: "You have to pay the fees",
                    date: today,
                    paymentDate,
                    paymentTime,
                    student: studentInfo,
                    daysLeft,
                    isExpired: true
                });
            }
            // Step 4: Check if already marked today (only for active members)
            const existingRecord = await storage.getAttendanceByDate(today);
            const alreadyMarked = existingRecord.some((r) => r.registerNo === registerNoString);
            if (alreadyMarked) {
                return res.status(200).json({
                    type: "warning",
                    message: "Attendance already marked for today",
                    date: today,
                    paymentDate,
                    paymentTime,
                    student: studentInfo,
                    daysLeft,
                    isExpired: false
                });
            }
            // Step 5: Active member and not yet marked - insert attendance
            const timeIn = now.toISOString();
            await storage.createAttendance({
                date: today,
                registerNo: student.registerNo,
                studentName: student.name,
                timeIn,
            });
            // Return success response
            res.status(200).json({
                type: "success",
                message: "Attendance marked successfully",
                date: today,
                timeIn,
                paymentDate,
                paymentTime,
                student: studentInfo,
                daysLeft,
                isExpired: false
            });
        }
        catch (error) {
            console.error("POST /api/attendance failed:", error);
            res.status(500).json({
                type: "error",
                message: "Failed to record attendance",
                student: null,
                daysLeft: 0,
                isExpired: false
            });
        }
    });
    const httpServer = createServer(app);
    return httpServer;
}
