import { pgTable, text, varchar, integer, date, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
// Students table
export const students = pgTable("students", {
    id: serial("id").primaryKey(),
    registerNo: varchar("register_no", { length: 50 }).notNull().unique(),
    name: text("name").notNull(),
    phone: varchar("phone", { length: 20 }).notNull().unique(),
    address: text("address").notNull(),
    joinDate: date("join_date").notNull(),
    expiryDate: date("expiry_date"),
    batch: varchar("batch", { length: 20 }).notNull().default("morning"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export function normalizeBatch(value) {
    if (value === null || value === undefined) {
        return "morning";
    }
    const key = String(value).trim().toLowerCase();
    return key.includes("evening") ? "evening" : "morning";
}
export function normalizePhone(value) {
    if (value === null || value === undefined) {
        return "";
    }
    let digits = String(value).replace(/[^0-9]/g, "");
    if (digits.length === 13 && digits.startsWith("091")) {
        return digits.slice(3);
    }
    if (digits.length === 12 && digits.startsWith("91")) {
        return digits.slice(2);
    }
    return digits;
}
export const insertStudentSchema = createInsertSchema(students).omit({
    id: true,
    createdAt: true,
    expiryDate: true,
}).extend({
    name: z.string().min(1, "Name is required").regex(/^[A-Za-z][A-Za-z .'-]*$/, "Name must contain only letters"),
    phone: z.string().regex(/^[0-9]{10}$/, "Phone number must be exactly 10 digits"),
    address: z.string().min(1, "Address is required"),
    batch: z.enum(["morning", "evening"]).default("morning"),
});
// Payments table
export const payments = pgTable("payments", {
    id: serial("id").primaryKey(),
    tokenNumber: varchar("token_number", { length: 50 }).notNull().unique(),
    date: date("date").notNull(),
    startDate: date("start_date"),
    expiryDate: date("expiry_date"),
    studentId: integer("student_id").notNull(),
    registerNo: varchar("register_no", { length: 50 }).notNull(),
    studentName: text("student_name").notNull(),
    duration: integer("duration").notNull(), // in calendar months
    amount: integer("amount").notNull(), // in rupees
    paymentMethod: varchar("payment_method", { length: 20 }).notNull(), // 'cash' or 'online'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // WhatsApp receipt delivery state. `pending` means "not attempted yet";
    // `sending` is a short-lived in-flight claim that makes a duplicate send
    // impossible; `sent` is terminal and blocks further automatic sends;
    // `failed` and `skipped` stay retryable via the manual resend button.
    whatsappStatus: varchar("whatsapp_status", { length: 20 }).notNull().default("pending"),
    whatsappMessageId: varchar("whatsapp_message_id", { length: 160 }),
    whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),
    whatsappError: text("whatsapp_error"),
    // Which presentation was actually delivered: "image" when the blue card went
    // out as a template header, "text" when it fell back to the text-only body.
    // Recorded so support can tell a customer what they really received.
    whatsappStyle: varchar("whatsapp_style", { length: 10 }),
    // Unguessable path segment for the public card URL that WhatsApp fetches.
    // A sequential payment id would make student names and amounts readable by
    // anyone who guessed a number, so the URL is keyed on this instead.
    whatsappCardToken: varchar("whatsapp_card_token", { length: 64 }),
});
// The receipt columns are omitted on purpose: they are written exclusively by the
// server, never by the request body. A client cannot mark its own receipt as
// `sent`, cannot forge the card URL, and cannot choose the presented style.
export const insertPaymentSchema = createInsertSchema(payments).omit({
    id: true,
    createdAt: true,
    whatsappStatus: true,
    whatsappMessageId: true,
    whatsappSentAt: true,
    whatsappError: true,
    whatsappStyle: true,
    whatsappCardToken: true,
});
// The full set of values `whatsapp_status` can hold, and the subset an
// automatic send may claim.
//
// `sending` and `sent` are excluded on purpose: an in-flight send and a
// completed one must both block a second automatic attempt. `failed` and
// `skipped` are included so a transient problem is retried on the next trigger
// rather than needing the owner to press Resend. Both storage layers import
// RETRYABLE_RECEIPT_STATUSES for the claim's WHERE clause, so the allowlist
// cannot drift between them.
export const WHATSAPP_RECEIPT_STATUSES = ["pending", "sending", "sent", "failed", "skipped"];
export const RETRYABLE_RECEIPT_STATUSES = WHATSAPP_RECEIPT_STATUSES.filter(
    (status) => status !== "sending" && status !== "sent",
);
// Attendance table
export const attendance = pgTable("attendance", {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    registerNo: varchar("register_no", { length: 50 }).notNull(),
    studentName: text("student_name").notNull(),
    timeIn: text("time_in").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertAttendanceSchema = createInsertSchema(attendance).omit({
    id: true,
    createdAt: true,
});
