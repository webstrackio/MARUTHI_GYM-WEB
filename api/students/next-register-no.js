import { storage } from "../../server/lib/storage.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const nextRegisterNo = await storage.getNextRegisterNo();
    res.json({ nextRegisterNo });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch next register number" });
  }
}
