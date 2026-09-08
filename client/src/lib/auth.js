import { useEffect, useState } from "react";
const listeners = new Set();
const STORAGE_KEY = "gym-management-session";
function readStoredSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        if (parsed.role !== "admin" && parsed.role !== "student")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function writeStoredSession(session) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    catch {
        // Storage unavailable (private mode / quota) – session stays in memory only.
    }
}
function clearStoredSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    }
    catch {
        // Ignore – nothing persisted.
    }
}
// Hydrate synchronously from localStorage so a browser refresh restores the
// session immediately instead of showing the login page.
let currentRole = null;
let currentStudent = null;
const restored = readStoredSession();
if (restored) {
    currentRole = restored.role;
    currentStudent = restored.role === "student" ? restored.student ?? null : null;
}
export function getRole() {
    return currentRole;
}
export function getStudentSession() {
    return currentStudent;
}
function notify() {
    for (const listener of listeners)
        listener();
}
function navigateTo(path) {
    if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
    }
}
export function loginAsAdmin() {
    currentRole = "admin";
    currentStudent = null;
    writeStoredSession({ role: "admin" });
    notify();
}
export function loginAsStudent(session) {
    currentRole = "student";
    currentStudent = session;
    writeStoredSession({ role: "student", student: session });
    notify();
}
export function logout() {
    currentRole = null;
    currentStudent = null;
    clearStoredSession();
    navigateTo("/login");
    notify();
}
export function useRole() {
    const [role, setRole] = useState(() => getRole());
    useEffect(() => {
        const handler = () => setRole(getRole());
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    }, []);
    return role;
}