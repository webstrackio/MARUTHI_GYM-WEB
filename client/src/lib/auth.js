import { useEffect, useState } from "react";
const listeners = new Set();
// Session is kept in memory only: every fresh start / page load shows the login page
let currentRole = null;
let currentStudent = null;
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
    notify();
}
export function loginAsStudent(session) {
    currentRole = "student";
    currentStudent = session;
    notify();
}
export function logout() {
    currentRole = null;
    currentStudent = null;
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
