import { storage } from "../../server/lib/storage.js";

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
      const updatedStudent = await storage.updateStudent(parseInt(id), req.body);
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
