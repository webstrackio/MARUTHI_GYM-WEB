export function formatSmsDate(date) {
    return new Date(date)
        .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    })
        .replace(/ /g, "-");
}
export function formatPlanLabel(duration) {
    if (duration % 12 === 0 && duration / 12 > 0) {
        return `${duration / 12} year${duration / 12 > 1 ? "s" : ""}`;
    }
    return `${duration} month${duration > 1 ? "s" : ""}`;
}
export function buildPaymentSms(input) {
    const methodLabel = input.paymentMethod === "cash" ? "Cash" : "Online";
    const gymName = input.gymName || "Gym";
    const ownerContact = gymName;
    const formattedAmount = (Number(input.amount) || 0).toLocaleString("en-IN");
    return [
        `Dear ${input.studentName},`,
        `Paid amount for the gym Rs.${formattedAmount}`,
        `${formatPlanLabel(input.duration)} plan via ${methodLabel}`,
        `Start Date: ${formatSmsDate(input.startDate)}`,
        `End Date: ${formatSmsDate(input.endDate)}`,
        `${gymName}`,
        `Contact: ${ownerContact}`,
        `Powered by ${gymName}`,
    ].join("\n");
}
export function buildSmsLink(phone, message) {
    return `sms:+91${phone}?body=${encodeURIComponent(message)}`;
}
