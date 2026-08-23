import { storage } from "../../server/lib/storage.js";
import { insertStudentSchema } from "../../shared/schema.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const students = await storage.getStudents();
      res.json(students);
    } catch (error) {
      console.error("GET /api/students failed:", error);
      res.status(500).json({ error: "Failed to fetch students" });
    }
  } else if (req.method === "POST") {
    try {
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
    } catch (error) {
      if (error.name === "ZodError") {
        console.error("POST /api/students validation failed:", error.errors);
        return res.status(400).json({ error: "Invalid student data", details: error.errors });
      }
      console.error("POST /api/students failed:", error);
      res.status(500).json({ error: "Failed to create student" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
