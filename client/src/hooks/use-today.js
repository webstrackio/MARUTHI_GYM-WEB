import { useEffect, useState } from "react";
function toLocalDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
}
// Returns today's local "YYYY-MM-DD" and triggers a re-render right after
// midnight, so date-based values like "Days Left" decrease live without a
// page reload.
export function useToday() {
    const [today, setToday] = useState(() => toLocalDate(new Date()));
    useEffect(() => {
        let timer;
        const schedule = () => {
            const now = new Date();
            const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const delay = nextMidnight.getTime() - now.getTime() + 1000;
            timer = setTimeout(() => {
                setToday(toLocalDate(new Date()));
                schedule();
            }, delay);
        };
        schedule();
        return () => clearTimeout(timer);
    }, []);
    return today;
}