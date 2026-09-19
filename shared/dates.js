// Converts a membership duration in months to a fixed number of days.
// Business rule: 1 month = 30 days (never calendar-month lengths), and
// 12 months = 365 days. Every other option (2, 3, 6 months) scales the
// 30-day month so all durations stay consistent with each other.
export function durationToDays(months) {
    return months === 12 ? 365 : months * 30;
}

// Adds a fixed number of whole days to a date. Operates in UTC so the result
// is timezone-independent (same behaviour as the rest of the date helpers).
export function addDaysUTC(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

// Returns a "YYYY-MM-DD" string for `date` plus a fixed-day membership
// duration. Example: 2026-09-18 + 1 month (30 days) = "2026-10-18".
export function calcExpiryDate(date, durationMonths) {
    return addDaysUTC(date, durationToDays(durationMonths)).toISOString().split("T")[0];
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

// Adds (or subtracts) whole days to a "YYYY-MM-DD" date string using *local*
// calendar arithmetic so a day never shifts because of a timezone. Returns a
// "YYYY-MM-DD" string. Example: "2026-09-18" + 1 -> "2026-09-19".
export function addDays(dateStr, days) {
    const d = parseDateString(dateStr);
    d.setDate(d.getDate() + days);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

// Returns today's date as a local "YYYY-MM-DD" string.
export function todayString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

// True when a value is a real calendar date in "YYYY-MM-DD" format (fixes
// values like "2026-02-30" being rejected). The internal storage format is
// always YYYY-MM-DD; DD/MM/YYYY is only ever a display/input convenience.
export function isDateString(dateStr) {
    if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return false;
    }
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}