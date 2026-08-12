import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const { Pool } = pg;
import { eq, and, sql } from "drizzle-orm";
import {
  students,
  payments,
  attendance,
  type Student,
  type InsertStudent,
  type Payment,
  type InsertPayment,
  type Attendance,
  type InsertAttendance,
} from "@shared/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface IStorage {
  // Students
  getStudents(): Promise<Student[]>;
  getStudentById(id: number): Promise<Student | undefined>;
  getStudentByRegisterNo(registerNo: string): Promise<Student | undefined>;
  getNextRegisterNo(): Promise<string>;
  createStudent(student: InsertStudent): Promise<Student>;
  updateStudent(id: number, student: Partial<InsertStudent>): Promise<Student>;
  deleteStudent(id: number): Promise<void>;

  // Payments
  getPayments(): Promise<Payment[]>;
  getPaymentById(id: number): Promise<Payment | undefined>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: Partial<Omit<InsertPayment, 'studentId' | 'registerNo' | 'studentName'>>): Promise<Payment>;
  deletePayment(id: number): Promise<void>;

  // Attendance
  getAttendanceByDate(date: string): Promise<Attendance[]>;
  getTodayAttendanceCount(): Promise<number>;
  createAttendance(attendance: InsertAttendance): Promise<Attendance>;

  // Dashboard stats
  getDashboardStats(): Promise<{
    totalStudents: number;
    activeMemberships: number;
    expiredMemberships: number;
    todayAttendance: number;
  }>;

  // Income stats
  getIncomeStats(): Promise<{
    cashInHand: number;
    onlinePayments: number;
    thisMonthIncome: number;
    thisYearIncome: number;
    totalOverallIncome: number;
    monthlyBreakdown: {
      month: string;
      amount: number;
      paymentCount: number;
    }[];
    averageMonthlyIncome: number;
    totalPaymentsReceived: number;
  }>;
}

export class DrizzleStorage implements IStorage {
  // Students
  async getStudents(): Promise<Student[]> {
    return db.select().from(students).orderBy(sql`${students.id} desc`);
  }

  async getStudentById(id: number): Promise<Student | undefined> {
    const result = await db.select().from(students).where(eq(students.id, id));
    return result[0];
  }

  async getStudentByRegisterNo(registerNo: string): Promise<Student | undefined> {
    const result = await db.select().from(students).where(eq(students.registerNo, registerNo));
    return result[0];
  }

  async getNextRegisterNo(): Promise<string> {
    const allStudents = await db.select().from(students);
    const maxRegisterNo = allStudents.reduce((max, s) => {
      const num = Number(s.registerNo);
      return Number.isInteger(num) && num >= 0 ? Math.max(max, num) : max;
    }, 0);
    return String(maxRegisterNo + 1);
  }

  async createStudent(student: InsertStudent): Promise<Student> {
    const result = await db.insert(students).values(student).returning();
    return result[0];
  }

  async updateStudent(id: number, student: Partial<InsertStudent>): Promise<Student> {
    const result = await db.update(students).set(student).where(eq(students.id, id)).returning();
    return result[0];
  }

  async deleteStudent(id: number): Promise<void> {
    await db.delete(students).where(eq(students.id, id));
  }

  // Payments
  async getPayments(): Promise<Payment[]> {
    return db.select().from(payments).orderBy(sql`${payments.id} desc`);
  }

  async getPaymentById(id: number): Promise<Payment | undefined> {
    const result = await db.select().from(payments).where(eq(payments.id, id));
    return result[0];
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const result = await db.insert(payments).values(payment).returning();
    return result[0];
  }

  async updatePayment(id: number, payment: Partial<Omit<InsertPayment, 'studentId' | 'registerNo' | 'studentName'>>): Promise<Payment> {
    const result = await db.update(payments).set(payment).where(eq(payments.id, id)).returning();
    return result[0];
  }

  async deletePayment(id: number): Promise<void> {
    await db.delete(payments).where(eq(payments.id, id));
  }

  // Attendance
  async getAttendanceByDate(date: string): Promise<Attendance[]> {
    return db.select().from(attendance).where(eq(attendance.date, date));
  }

  async getTodayAttendanceCount(): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const result = await db.select({ count: sql<number>`count(*)` }).from(attendance).where(eq(attendance.date, today));
    return Number(result[0]?.count ?? 0);
  }

  async createAttendance(record: InsertAttendance): Promise<Attendance> {
    const result = await db.insert(attendance).values(record).returning();
    return result[0];
  }

  // Dashboard stats
  async getDashboardStats() {
    const allStudents = await db.select().from(students);
    const today = new Date().toISOString().split("T")[0];
    const todayAttendanceRows = await db.select().from(attendance).where(eq(attendance.date, today));

    const now = new Date();
    const activeMemberships = allStudents.filter(s => {
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

  // Income stats
  async getIncomeStats() {
    const allPayments = await db.select().from(payments);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const cashInHand = allPayments
      .filter(p => p.paymentMethod === "cash")
      .reduce((sum, p) => sum + p.amount, 0);

    const onlinePayments = allPayments
      .filter(p => p.paymentMethod === "online")
      .reduce((sum, p) => sum + p.amount, 0);

    const thisMonthIncome = allPayments
      .filter(p => {
        const d = new Date(p.date);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      })
      .reduce((sum, p) => sum + p.amount, 0);

    const thisYearIncome = allPayments
      .filter(p => new Date(p.date).getFullYear() === currentYear)
      .reduce((sum, p) => sum + p.amount, 0);

    const totalOverallIncome = allPayments.reduce((sum, p) => sum + p.amount, 0);

    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ];

    const monthlyBreakdown = monthNames.map((month, index) => {
      const monthPayments = allPayments.filter(p => {
        const d = new Date(p.date);
        return d.getFullYear() === currentYear && d.getMonth() === index;
      });
      return {
        month,
        amount: monthPayments.reduce((sum, p) => sum + p.amount, 0),
        paymentCount: monthPayments.length,
      };
    });

    const monthsWithData = monthlyBreakdown.filter(m => m.paymentCount > 0).length;
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
