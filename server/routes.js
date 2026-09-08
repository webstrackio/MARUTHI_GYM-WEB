import { createServer } from "http";
import { storage } from "./storage.js";
import { insertStudentSchema, insertPaymentSchema } from "../shared/schema.js";
import { addCalendarMonths, toDateInputValue, daysUntil } from "../shared/dates.js";
export async function registerRoutes(app) {
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
                registerNo,
            });
            const student = await storage.createStudent(validatedData);
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
            const updatedStudent = await storage.updateStudent(id, req.body);
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
            const expiryDate = toDateInputValue(addCalendarMonths(baseDate, durationMonths));
            const validatedData = insertPaymentSchema.parse({
                ...req.body,
                duration: durationMonths,
                startDate: req.body.startDate || req.body.date,
                expiryDate,
                tokenNumber,
            });
            const payment = await storage.createPayment(validatedData);
            await storage.updateStudent(validatedData.studentId, {
                expiryDate,
            });
            res.status(201).json(payment);
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
            if (req.body.duration !== undefined) {
                const durationMonths = Number(req.body.duration);
                if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
                    return res.status(400).json({ error: "Duration must be a whole number of months (1 - 120)" });
                }
            }
            const updatedPayment = await storage.updatePayment(id, req.body);
            await storage.recomputeStudentExpiry(updatedPayment.studentId);
            res.json(updatedPayment);
        }
        catch (error) {
            console.error(`PATCH /api/payments/${req.params.id} failed:`, error);
            res.status(500).json({ error: "Failed to update payment" });
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
            res.status(500).json({ error: "Failed to delete payment" });
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
    // Attendance endpoints
    app.get("/api/attendance", async (req, res) => {
        try {
            const date = req.query.date || new Date().toISOString().split("T")[0];
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
            // Step 3: Check if expired FIRST - don't insert for expired members
            if (isExpired) {
                return res.status(200).json({
                    type: "expired",
                    message: "You have to pay the fees",
                    student: {
                        name: student.name,
                        registerNumber: student.registerNo,
                        expiryDate: student.expiryDate
                    },
                    daysLeft,
                    isExpired: true
                });
            }
            // Step 4: Check if already marked today (only for active members)
            const today = new Date().toISOString().split("T")[0];
            const existingRecord = await storage.getAttendanceByDate(today);
            const alreadyMarked = existingRecord.some((r) => r.registerNo === registerNoString);
            if (alreadyMarked) {
                return res.status(200).json({
                    type: "warning",
                    message: "Attendance already marked for today",
                    student: {
                        name: student.name,
                        registerNumber: student.registerNo,
                        expiryDate: student.expiryDate
                    },
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
                timeIn,
                student: {
                    name: student.name,
                    registerNumber: student.registerNo,
                    expiryDate: student.expiryDate
                },
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
