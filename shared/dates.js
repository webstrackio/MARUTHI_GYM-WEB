// Adds a whole number of calendar months to a date, clamping the day-of-month
// to the last valid day of the target month (e.g. Jan 31 + 1 month = Feb 28).
// Operates in UTC so the result is timezone-independent.
export function addCalendarMonths(date, months) {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + Math.floor(months);
    const day = d.getUTCDate();
    const first = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, lastDay));
    return first;
}
export function toDateInputValue(date) {
    return date.toISOString().split("T")[0];
}

// Formats a date as DD/MM/YYYY with day and month zero-padded to 2 digits.
// Accepts Date objects, "YYYY-MM-DD" strings, ISO date-time strings, or any
// value liked by `new Date()`. Never changes the underlying stored value.
// Example: "2026-08-25" displays as "25/08/2026", never "08/25/2026".
export function formatDate(date) {
    if (date === null || date === undefined || date === "") {
        return "";
    }
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
        const [y, m, d] = date.slice(0, 10).split("-").map(Number);
        if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)) {
            return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
        }
    }
    const dt = new Date(date);
    if (isNaN(dt.getTime())) {
        return String(date);
    }
    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${dt.getFullYear()}`;
}

// Parses a "YYYY-MM-DD" date string as a *local* midnight date so calendar-day
// arithmetic stays stable regardless of the current time of day.
export function parseDateString(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
}

// Truncates a Date to local midnight.
export function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole calendar days from today until the given expiry date. Positive means
// days remaining, 0 means expiring today, negative means days overdue.
// Example: expiry "2026-10-07" is 30 on 2026-09-07, 29 on 2026-09-08, 0 on
// 2026-10-07, -1 on 2026-10-08.
export function daysUntil(expiryDate, from = new Date()) {
    if (!expiryDate)
        return 0;
    const expiryLocal = parseDateString(expiryDate);
    const todayLocal = startOfDay(from);
    return Math.round((expiryLocal.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
}