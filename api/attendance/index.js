import { storage } from "../../server/lib/storage.js";
import { daysUntil } from "../../shared/dates.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const date = req.query.date || new Date().toISOString().split("T")[0];
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
      if (isExpired) {
        return res.status(200).json({
          type: "expired",
          message: "You have to pay the fees",
          student: {
            name: student.name,
            registerNumber: student.registerNo,
            expiryDate: student.expiryDate,
          },
          daysLeft,
          isExpired: true,
        });
      }
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
            expiryDate: student.expiryDate,
          },
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
        timeIn,
        student: {
          name: student.name,
          registerNumber: student.registerNo,
          expiryDate: student.expiryDate,
        },
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
