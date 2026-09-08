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