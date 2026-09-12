import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
export function formatIndianNumber(value) {
    const num = Number(value);
    return (Number.isFinite(num) ? num : 0).toLocaleString("en-IN");
}
export function formatCurrency(amount) {
    return `₹ ${formatIndianNumber(amount)}`;
}
