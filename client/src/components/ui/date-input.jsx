import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate } from "@shared/dates";
// Parses a "DD/MM/YYYY" display string into a "YYYY-MM-DD" storage string.
// Returns "" for anything that is not a real calendar date.
export function parseDdmmyyyy(text) {
    const match = (text || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match)
        return "";
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return "";
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day)
        return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// A dual-mode date field. It shows a plain editable text input that formats
// keystrokes as DD/MM/YYYY, backed by a native date picker that opens when the
// calendar icon is clicked. `value` is always "YYYY-MM-DD"; `onChange` fires
// with the parsed value once a complete valid date is entered or picked.
// `onTextChange` fires with the raw DD/MM/YYYY text on every keystroke so the
// parent can validate what the user actually typed.
export function DateInput({ value, onChange, onTextChange, disabled = false, readOnly = false, className, placeholder = "DD/MM/YYYY", label, "data-testid": dataTestId, "data-testid-calendar": dataTestIdCalendar }) {
    const [text, setText] = useState(() => formatDate(value));
    const lastValue = useRef(value);
    useEffect(() => {
        if (value !== lastValue.current) {
            lastValue.current = value;
            setText(formatDate(value));
        }
    }, [value]);
    const toDigits = (raw) => raw.replace(/\D/g, "").slice(0, 8);
    const mask = (digits) => {
        if (digits.length > 4)
            return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
        if (digits.length > 2)
            return `${digits.slice(0, 2)}/${digits.slice(2)}`;
        return digits;
    };
    const handleTextChange = (e) => {
        if (readOnly || disabled)
            return;
        const digits = toDigits(e.target.value);
        const formatted = mask(digits);
        setText(formatted);
        const parsed = digits.length === 8 ? parseDdmmyyyy(formatted) : "";
        if (parsed) {
            lastValue.current = parsed;
            onChange(parsed);
        }
        else if (digits.length === 0) {
            onChange("");
        }
        onTextChange?.(formatted);
    };
    const handlePickerChange = (e) => {
        const picked = e.target.value;
        e.target.value = "";
        if (!picked)
            return;
        lastValue.current = picked;
        setText(formatDate(picked));
        onChange(picked);
        onTextChange?.(formatDate(picked));
    };
    return (<div className="relative">
      <Input value={text} onChange={handleTextChange} placeholder={placeholder} disabled={disabled} readOnly={readOnly} aria-label={label} className={cn("pr-9", className)} data-testid={dataTestId}/>
      <Calendar className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
      <input type="date" value={value || ""} onChange={handlePickerChange} aria-label={`${label} calendar`} data-testid={dataTestIdCalendar} disabled={disabled || readOnly} style={{ colorScheme: "light dark" }} className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 cursor-pointer opacity-0"/>
    </div>);
}