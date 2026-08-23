import { storage } from "../../server/lib/storage.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error("GET /api/dashboard/stats failed:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
}
