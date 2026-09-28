import { daysUntil, formatDate, formatTimeIST } from "./dates.js";

// Default name used on receipts when the server has no GYM_NAME configured.
// Matches DEFAULT_GYM_NAME in client/src/lib/whatsapp.js so the card, the
// manual WhatsApp dialogs and the automatic receipt all say the same thing.
export const DEFAULT_GYM_NAME = "Maruthi Gym";

// India country code. Student numbers are stored as 10 local digits, so this is
// what the Cloud API expects prefixed on to reach a real handset.
export const WHATSAPP_COUNTRY_CODE = "91";

// The approved WhatsApp template this receipt is sent through. Meta requires a
// business-initiated message outside the 24-hour customer-service window to use
// an approved template, and the name must match the one created in the Meta
// dashboard. Override with WHATSAPP_TEMPLATE_NAME if you named it differently.
export const DEFAULT_RECEIPT_TEMPLATE = "gym_payment_receipt";

// Converts a stored student phone number into the E.164 form the Cloud API
// wants: digits only, no "+", with the country code present exactly once.
// Returns null when the number is missing or not a usable Indian mobile number,
// so the caller can skip sending instead of messaging a wrong number.
//   "9876543210"     -> "919876543210"
//   "+91 98765 43210"-> "919876543210"
//   "0919876543210"  -> "919876543210"
//   "919876543210"   -> "919876543210"   (already prefixed, not doubled)
//   "" / null / "12" -> null
export function toWhatsAppNumber(phone) {
  if (phone === null || phone === undefined) {
    return null;
  }
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("091")) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    return null;
  }
  return `${WHATSAPP_COUNTRY_CODE}${digits}`;
}

// The two-state membership status used on the check-in / receipt card. This is
// deliberately coarser than the four-state badge on the Students page
// (Active / Expiring Today / Pay Required / Expired): a receipt is a point-in-
// time document, so it only records "usable right now" vs "not usable".
export function getReceiptStatus(expiryDate, from = new Date()) {
  if (!expiryDate) {
    return "EXPIRED";
  }
  return daysUntil(expiryDate, from) > 0 ? "ACTIVE" : "EXPIRED";
}

// "1500" -> "₹ 1,500", matching formatCurrency in client/src/lib/utils.js so the
// receipt shows the same amount with the same formatting as the website card.
export function formatReceiptAmount(amount) {
  const num = Number(amount);
  const safe = Number.isFinite(num) ? num : 0;
  return `₹ ${safe.toLocaleString("en-IN")}`;
}

// Builds every field of the receipt from the stored payment row plus the
// student's current record.
//
// The critical rule here: `date` and `time` come from the payment row itself
// (`payment.date` and `payment.createdAt`), never from "now". Resending a
// receipt for a payment taken in March must still say March, not today's date.
//
// `now` is injectable purely so tests are deterministic. Production always
// passes the real current time, and it is used for one thing only: the "Days
// Left" countdown, which is a live number on the website card too.
export function buildReceiptData(payment, student, options = {}) {
  const now = options.now ?? new Date();
  const gymName = (options.gymName || "").trim() || DEFAULT_GYM_NAME;
  const expiryDate = payment?.expiryDate || student?.expiryDate || null;
  const daysLeft = Math.max(0, daysUntil(expiryDate, now));
  return {
    gymName,
    studentName: payment?.studentName || student?.name || "",
    registerNo: payment?.registerNo || student?.registerNo || "",
    paymentDate: formatDate(payment?.date),
    expiryDate: formatDate(expiryDate),
    paymentTime: formatTimeIST(payment?.createdAt),
    daysLeft,
    daysLeftText: `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
    status: getReceiptStatus(expiryDate, now),
    amount: formatReceiptAmount(payment?.amount),
    // Distinct from `status`, which describes the *membership*. This one
    // describes the *payment*, and it is only ever "PAID" because the receipt is
    // built from a row that is already committed to the payments table - the
    // sender is only ever reached after a successful insert.
    paymentStatus: "PAID",
    paymentMethod: payment?.paymentMethod || "",
    tokenNumber: payment?.tokenNumber || "",
    to: toWhatsAppNumber(student?.phone ?? payment?.phone),
  };
}

// Plain-text receipt body. The bold `*name*` markers and the 🟢/💪 emoji are
// WhatsApp's own formatting, so the message renders like the blue card on the
// site rather than like a wall of plain text.
export function buildReceiptMessage(data) {
  return [
    `🟢 *${data.gymName}*`,
    "",
    "*Payment Successful*",
    "",
    `*Name:* ${data.studentName}`,
    `*Date:* ${data.paymentDate}`,
    `*Expiry:* ${data.expiryDate}`,
    `*Time:* ${data.paymentTime}`,
    `*Days Left:* ${data.daysLeftText}`,
    `*Status:* ${data.status}`,
    `*Payment:* ${data.amount}`,
    `*Payment Status:* ${data.paymentStatus}`,
    "",
    "Thank you for your payment! 💪",
    `— *${data.gymName}*`,
  ].join("\n");
}

// The `{{1}}`..`{{9}}` values for the approved template, in the exact order the
// template body declares them. Create the Meta template body as:
//
//   🟢 *{{1}}*
//   *Payment Successful*
//   *Name:* {{2}}
//   *Date:* {{3}}
//   *Expiry:* {{4}}
//   *Time:* {{5}}
//   *Days Left:* {{6}}
//   *Status:* {{7}}
//   *Payment:* {{8}}
//   *Payment Status:* {{9}}
//   Thank you for your payment! 💪
//   — *{{1}}*
//
// so the order here and the order in Meta can never drift apart unnoticed.
// `buildReceiptTemplateParameters` is the single source of that order, and
// tests/verify-template-order.mjs prints it for pasting into Meta.
export function buildReceiptTemplateParameters(data) {
  return [
    data.gymName,
    data.studentName,
    data.paymentDate,
    data.expiryDate,
    data.paymentTime,
    data.daysLeftText,
    data.status,
    data.amount,
    data.paymentStatus,
  ];
}
