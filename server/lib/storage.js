import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { students, payments, attendance } from "../../shared/schema.js";

const client = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
const db = drizzle(client);

export class DrizzleStorage {
  async getStudents() {
    return db.select().from(students).orderBy(sql`${students.id} desc`);
  }
  async getStudentById(id) {
    const result = await db.select().from(students).where(eq(students.id, id));
    return result[0];
  }
  async getStudentByRegisterNo(registerNo) {
    const result = await db.select().from(students).where(eq(students.registerNo, registerNo));
    return result[0];
  }
  async getNextRegisterNo() {
    const allStudents = await db.select().from(students);
    const maxRegisterNo = allStudents.reduce((max, s) => {
      const num = Number(s.registerNo);
      return Number.isInteger(num) && num >= 0 ? Math.max(max, num) : max;
    }, 0);
    return String(maxRegisterNo + 1);
  }
  async createStudent(student) {
    const result = await db.insert(students).values(student).returning();
    return result[0];
  }
  async updateStudent(id, student) {
    const result = await db.update(students).set(student).where(eq(students.id, id)).returning();
    return result[0];
  }
  async deleteStudent(id) {
    await db.delete(students).where(eq(students.id, id));
  }
  async getPayments() {
    return db.select().from(payments).orderBy(sql`${payments.id} desc`);
  }
  async getPaymentById(id) {
    const result = await db.select().from(payments).where(eq(payments.id, id));
    return result[0];
  }
  async createPayment(payment) {
    const result = await db.insert(payments).values(payment).returning();
    return result[0];
  }
  async updatePayment(id, payment) {
    const result = await db.update(payments).set(payment).where(eq(payments.id, id)).returning();
    return result[0];
  }
  async deletePayment(id) {
    await db.delete(payments).where(eq(payments.id, id));
  }
  async getAttendanceByDate(date) {
    return db.select().from(attendance).where(eq(attendance.date, date));
  }
  async createAttendance(record) {
    const result = await db.insert(attendance).values(record).returning();
    return result[0];
  }
  async getDashboardStats() {
    const allStudents = await db.select().from(students);
    const today = new Date().toISOString().split("T")[0];
    const todayAttendanceRows = await db.select().from(attendance).where(eq(attendance.date, today));
    const now = new Date();
    const activeMemberships = allStudents.filter((s) => {
      if (!s.expiryDate) return false;
      return new Date(s.expiryDate) > now;
    }).length;
    return {
      totalStudents: allStudents.length,
      activeMemberships,
      expiredMemberships: allStudents.length - activeMemberships,
      todayAttendance: todayAttendanceRows.length,
    };
  }
  async getIncomeStats() {
    const allPayments = await db.select().from(payments);
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const cashInHand = allPayments.filter((p) => p.paymentMethod === "cash").reduce((sum, p) => sum + p.amount, 0);
    const onlinePayments = allPayments.filter((p) => p.paymentMethod === "online").reduce((sum, p) => sum + p.amount, 0);
    const thisMonthIncome = allPayments
      .filter((p) => {
        const d = new Date(p.date);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      })
      .reduce((sum, p) => sum + p.amount, 0);
    const thisYearIncome = allPayments
      .filter((p) => new Date(p.date).getFullYear() === currentYear)
      .reduce((sum, p) => sum + p.amount, 0);
    const totalOverallIncome = allPayments.reduce((sum, p) => sum + p.amount, 0);
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const monthlyBreakdown = monthNames.map((month, index) => {
      const monthPayments = allPayments.filter((p) => {
        const d = new Date(p.date);
        return d.getFullYear() === currentYear && d.getMonth() === index;
      });
      return {
        month,
        amount: monthPayments.reduce((sum, p) => sum + p.amount, 0),
        paymentCount: monthPayments.length,
      };
    });
    const monthsWithData = monthlyBreakdown.filter((m) => m.paymentCount > 0).length;
    const averageMonthlyIncome = monthsWithData > 0 ? Math.round(thisYearIncome / monthsWithData) : 0;
    return {
      cashInHand,
      onlinePayments,
      thisMonthIncome,
      thisYearIncome,
      totalOverallIncome,
      monthlyBreakdown,
      averageMonthlyIncome,
      totalPaymentsReceived: allPayments.length,
    };
  }
}

export const storage = new DrizzleStorage();
