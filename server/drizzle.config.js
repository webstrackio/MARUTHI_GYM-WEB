import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL, ensure the database is provisioned");
}
export default defineConfig({
    out: path.resolve(__dirname, "./migrations").replace(/\\/g, "/"),
    schema: path.resolve(__dirname, "../shared/schema.js").replace(/\\/g, "/"),
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
});
