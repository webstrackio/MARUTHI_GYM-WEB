import "dotenv/config";
import pg from "pg";
import { normalizePhone } from "../../shared/schema.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run this from the project root with your .env present.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function main() {
    const { rows } = await pool.query(
        'SELECT id, "register_no", name, phone, batch FROM students ORDER BY id'
    );
    console.log(`Found ${rows.length} student record(s).`);

    if (rows.length === 0) {
        await createUniqueIndex();
        return;
    }

    // 1. Normalize how the phone values are stored (strip spaces, +91, etc.).
    let normalized = 0;
    for (const row of rows) {
        const clean = normalizePhone(row.phone);
        if (clean !== row.phone) {
            await pool.query("UPDATE students SET phone = $1 WHERE id = $2", [clean, row.id]);
            console.log(`Normalized phone for student id=${row.id} (${row.name}): "${row.phone}" -> "${clean}"`);
            normalized += 1;
        }
    }
    if (normalized > 0) {
        console.log(`Normalized ${normalized} phone value(s) in the database.`);
    }
    else {
        console.log("All stored phone numbers are already normalized.");
    }

    // 2. Detect duplicate phones across the whole database (any batch/status).
    const byPhone = new Map();
    for (const row of rows) {
        const key = normalizePhone(row.phone);
        if (!byPhone.has(key))
            byPhone.set(key, []);
        byPhone.get(key).push(row);
    }
    const duplicateGroups = [...byPhone.entries()].filter(([, list]) => list.length > 1);

    if (duplicateGroups.length === 0) {
        console.log("No duplicate phone numbers found.");
        await createUniqueIndex();
        return;
    }

    // 3. Report duplicates only - existing students are never deleted automatically.
    console.log("\n===============================");
    console.log("DUPLICATE PHONE NUMBERS FOUND:");
    console.log("===============================");
    for (const [phone, list] of duplicateGroups) {
        console.log(`\nPhone: ${phone}`);
        for (const s of list) {
            console.log(`  - id=${s.id} | register_no=${s.register_no} | name=${s.name} | batch=${s.batch}`);
        }
    }
    console.log("\nNo unique index created because duplicate records still exist.");
    console.log("The API now blocks NEW duplicates with a 409 response.");
    console.log("To finish the database-level constraint, review the records above, keep only one student per phone number, then re-run this script.");
}

async function createUniqueIndex() {
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS "students_phone_unique" ON students ("phone")');
    console.log("Unique index 'students_phone_unique' created on students.phone.");
}

main()
    .then(() => pool.end())
    .catch(async (error) => {
        console.error("Migration failed:", error);
        await pool.end();
        process.exit(1);
    });