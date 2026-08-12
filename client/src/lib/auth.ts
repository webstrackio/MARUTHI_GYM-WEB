import { useEffect, useState } from "react";

const ROLE_KEY = "gymdesk_role";
const STUDENT_KEY = "gymdesk_student";

export type Role = "admin" | "student" | null;

export interface StudentSession {
  id: number;
  registerNo: string;
  name: string;
  phone: string;
}

const listeners = new Set<() => void>();

export function getRole(): Role {
  return localStorage.getItem(ROLE_KEY) as Role;
}

export function getStudentSession(): StudentSession | null {
  try {
    const raw = localStorage.getItem(STUDENT_KEY);
    return raw ? (JSON.parse(raw) as StudentSession) : null;
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

export function loginAsAdmin() {
  localStorage.setItem(ROLE_KEY, "admin");
  localStorage.removeItem(STUDENT_KEY);
  notify();
}

export function loginAsStudent(session: StudentSession) {
  localStorage.setItem(ROLE_KEY, "student");
  localStorage.setItem(STUDENT_KEY, JSON.stringify(session));
  notify();
}

export function logout() {
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(STUDENT_KEY);
  notify();
  window.location.assign("/admin");
}

export function useRole(): Role {
  const [role, setRole] = useState<Role>(() => getRole());
  useEffect(() => {
    const handler = () => setRole(getRole());
    listeners.add(handler);
    window.addEventListener("storage", handler);
    return () => {
      listeners.delete(handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return role;
}
