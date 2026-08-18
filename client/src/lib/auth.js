import { useEffect, useState } from "react";
const ROLE_KEY = "gymdesk_role";
const STUDENT_KEY = "gymdesk_student";
const listeners = new Set();
export function getRole() {
    return localStorage.getItem(ROLE_KEY);
}
export function getStudentSession() {
    try {
        const raw = localStorage.getItem(STUDENT_KEY);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
function notify() {
    for (const listener of listeners)
        listener();
}
export function loginAsAdmin() {
    localStorage.setItem(ROLE_KEY, "admin");
    localStorage.removeItem(STUDENT_KEY);
    notify();
}
export function loginAsStudent(session) {
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
export function useRole() {
    const [role, setRole] = useState(() => getRole());
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
