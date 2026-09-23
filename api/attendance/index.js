import { storage } from "../../server/lib/storage.js";
import { daysUntil, todayString } from "../../shared/dates.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const date = req.query.date || todayString();
      const records = await storage.getAttendanceByDate(date);
      res.json(records);
    } catch (error) {
      console.error("GET /api/attendance failed:", error);
      res.status(500).json({ error: "Failed to fetch attendance records" });
    }
  } else if (req.method === "POST") {
    try {
      const registerNumber = req.body.registerNumber || req.body.registerNo;
      if (!registerNumber || registerNumber === "") {
        return res.status(400).json({
          type: "error",
          message: "Register number is required",
          student: null,
          daysLeft: 0,
          isExpired: false,
        });
      }
      const registerNoString = String(registerNumber).trim();
      const student = await storage.getStudentByRegisterNo(registerNoString);
      if (!student) {
        return res.status(404).json({
          type: "error",
          message: "Student not found",
          student: null,
          daysLeft: 0,
          isExpired: false,
        });
      }
      const now = new Date();
      const daysLeft = Math.max(0, daysUntil(student.expiryDate));
      const isExpired = !student.expiryDate || daysLeft <= 0;
      const today = todayString();
      // Saved payment timestamp from the database (written once when the fee
      // was paid) - never the current time.
      const latestPayment = await storage.getLatestPaymentByStudentId(student.id);
      const paymentDate = latestPayment?.date ?? null;
      const paymentTime = latestPayment?.createdAt ?? null;
      const studentInfo = {
        name: student.name,
        registerNumber: student.registerNo,
        expiryDate: student.expiryDate,
        joinDate: student.joinDate,
      };
      if (isExpired) {
        return res.status(200).json({
          type: "expired",
          message: "You have to pay the fees",
          date: today,
          paymentDate,
          paymentTime,
          student: studentInfo,
          daysLeft,
          isExpired: true,
        });
      }
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
          isExpired: false,
        });
      }
      const timeIn = now.toISOString();
      await storage.createAttendance({
        date: today,
        registerNo: student.registerNo,
        studentName: student.name,
        timeIn,
      });
      res.status(200).json({
        type: "success",
        message: "Attendance marked successfully",
        date: today,
        timeIn,
        paymentDate,
        paymentTime,
        student: studentInfo,
        daysLeft,
        isExpired: false,
      });
    } catch (error) {
      console.error("POST /api/attendance failed:", error);
      res.status(500).json({
        type: "error",
        message: "Failed to record attendance",
        student: null,
        daysLeft: 0,
        isExpired: false,
      });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
