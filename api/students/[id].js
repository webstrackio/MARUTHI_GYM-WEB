import { storage } from "../../server/lib/storage.js";
import { normalizeBatch, normalizePhone } from "../../shared/schema.js";

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "GET") {
    try {
      const student = await storage.getStudentById(parseInt(id));
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }
      res.json(student);
    } catch (error) {
      console.error(`GET /api/students/${id} failed:`, error);
      res.status(500).json({ error: "Failed to fetch student" });
    }
  } else if (req.method === "PATCH") {
    try {
      const student = await storage.getStudentById(parseInt(id));
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
        if (duplicate && duplicate.id !== parseInt(id)) {
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
      const updatedStudent = await storage.updateStudent(parseInt(id), allowedFields);
      res.json(updatedStudent);
    } catch (error) {
      console.error(`PATCH /api/students/${id} failed:`, error);
      res.status(500).json({ error: "Failed to update student" });
    }
  } else if (req.method === "DELETE") {
    try {
      const student = await storage.getStudentById(parseInt(id));
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }
      await storage.deleteStudent(parseInt(id));
      res.status(204).send();
    } catch (error) {
      console.error(`DELETE /api/students/${id} failed:`, error);
      res.status(500).json({ error: "Failed to delete student" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
