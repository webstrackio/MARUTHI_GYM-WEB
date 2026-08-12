export interface PaymentSmsInput {
  studentName: string;
  amount: number;
  duration: number;
  paymentMethod: "cash" | "online";
  startDate: string | Date;
  endDate: string | Date;
  gymName: string;
}

export function formatSmsDate(date: string | Date): string {
  return new Date(date)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(/ /g, "-");
}

export function formatPlanLabel(duration: number): string {
  if (duration % 365 === 0 && duration / 365 > 0) {
    return `${duration / 365} year${duration / 365 > 1 ? "s" : ""}`;
  }
  if (duration % 30 === 0 && duration / 30 > 0) {
    return `${duration / 30} month${duration / 30 > 1 ? "s" : ""}`;
  }
  return `${duration} days`;
}

export function buildPaymentSms(input: PaymentSmsInput): string {
  const methodLabel = input.paymentMethod === "cash" ? "Cash" : "Online";
  const gymName = input.gymName || "Gym";
  const ownerContact = gymName;

  return [
    `Dear ${input.studentName},`,
    `Paid amount for the gym Rs.${input.amount}`,
    `${formatPlanLabel(input.duration)} plan via ${methodLabel}`,
    `Start Date: ${formatSmsDate(input.startDate)}`,
    `End Date: ${formatSmsDate(input.endDate)}`,
    `${gymName}`,
    `Contact: ${ownerContact}`,
    `Powered by ${gymName}`,
  ].join("\n");
}

export function buildSmsLink(phone: string, message: string): string {
  return `sms:+91${phone}?&body=${encodeURIComponent(message)}`;
}
