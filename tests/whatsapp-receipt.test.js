import { describe, expect, it } from "vitest";
import {
  DEFAULT_GYM_NAME,
  buildReceiptData,
  buildReceiptMessage,
  buildReceiptTemplateParameters,
  formatReceiptAmount,
  getReceiptStatus,
  toWhatsAppNumber,
} from "../shared/whatsapp-receipt.js";
import { RETRYABLE_RECEIPT_STATUSES, WHATSAPP_RECEIPT_STATUSES } from "../shared/schema.js";
import { makePayment, makeStudent } from "./helpers.js";

describe("receipt status allowlist", () => {
  // Both storage layers import RETRYABLE_RECEIPT_STATUSES for the claim's WHERE
  // clause. This pins the exact contents, because a regression here silently
  // reintroduces duplicate WhatsApp messages.
  it("excludes only the in-flight and completed states from the claimable set", () => {
    expect(WHATSAPP_RECEIPT_STATUSES).toEqual(["pending", "sending", "sent", "failed", "skipped"]);
    expect(RETRYABLE_RECEIPT_STATUSES).toEqual(["pending", "failed", "skipped"]);
  });

  it("keeps both lists in sync", () => {
    expect(RETRYABLE_RECEIPT_STATUSES.every((s) => WHATSAPP_RECEIPT_STATUSES.includes(s))).toBe(true);
  });
});

describe("toWhatsAppNumber", () => {
  it("prefixes the Indian country code on a stored 10-digit number", () => {
    expect(toWhatsAppNumber("9876543210")).toBe("919876543210");
  });

  it.each([
    ["+91 98765 43210", "919876543210"],
    ["0919876543210", "919876543210"],
    ["919876543210", "919876543210"],
    ["  98765-43210  ", "919876543210"],
  ])("normalises %s to %s without doubling the country code", (input, expected) => {
    expect(toWhatsAppNumber(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "12345", "98765432101234"])(
    "returns null for the unusable number %s",
    (input) => {
      expect(toWhatsAppNumber(input)).toBeNull();
    },
  );
});

describe("formatReceiptAmount", () => {
  it.each([
    [1500, "₹ 1,500"],
    [100000, "₹ 1,00,000"],
    [0, "₹ 0"],
    [undefined, "₹ 0"],
    [Number.NaN, "₹ 0"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatReceiptAmount(input)).toBe(expected);
  });
});

describe("getReceiptStatus", () => {
  const now = new Date("2026-09-28T00:00:00");

  it("is ACTIVE while days remain", () => {
    expect(getReceiptStatus("2026-10-09", now)).toBe("ACTIVE");
  });

  it("is EXPIRED on the expiry day itself", () => {
    expect(getReceiptStatus("2026-09-28", now)).toBe("EXPIRED");
  });

  it("is EXPIRED once the expiry day has passed", () => {
    expect(getReceiptStatus("2026-09-27", now)).toBe("EXPIRED");
  });

  it("treats a member with no expiry date as EXPIRED", () => {
    expect(getReceiptStatus(null, now)).toBe("EXPIRED");
  });
});

describe("buildReceiptData", () => {
  it("shows the correct status and days left for an active membership", () => {
    const data = buildReceiptData(makePayment(), makeStudent(), { now: new Date("2026-09-28T00:00:00") });
    expect(data.status).toBe("ACTIVE");
    expect(data.daysLeft).toBe(11);
    expect(data.daysLeftText).toBe("11 days");
  });

  it("shows EXPIRED and zero days left once the membership has lapsed", () => {
    const data = buildReceiptData(
      makePayment({ expiryDate: "2026-09-01" }),
      makeStudent({ expiryDate: "2026-09-01" }),
      { now: new Date("2026-09-28T00:00:00") },
    );
    expect(data.status).toBe("EXPIRED");
    expect(data.daysLeft).toBe(0);
    expect(data.daysLeftText).toBe("0 days");
  });

  it("uses the singular 'day' when exactly one day remains", () => {
    const data = buildReceiptData(makePayment({ expiryDate: "2026-09-29" }), makeStudent(), {
      now: new Date("2026-09-28T00:00:00"),
    });
    expect(data.daysLeftText).toBe("1 day");
  });

  it("takes the recipient from the student's own saved number", () => {
    const data = buildReceiptData(makePayment(), makeStudent({ phone: "9000000001" }));
    expect(data.to).toBe("919000000001");
  });

  it("falls back to the default gym name when none is configured", () => {
    expect(buildReceiptData(makePayment(), makeStudent(), { gymName: "  " }).gymName).toBe(DEFAULT_GYM_NAME);
    expect(buildReceiptData(makePayment(), makeStudent(), { gymName: "Anytime Fitness" }).gymName).toBe("Anytime Fitness");
  });
});

describe("buildReceiptMessage", () => {
  const data = buildReceiptData(makePayment(), makeStudent(), {
    now: new Date("2026-09-28T00:00:00"),
    gymName: "Maruthi Gym",
  });

  it("renders the card layout with every required field", () => {
    expect(buildReceiptMessage(data)).toBe(
      [
        "🟢 *Maruthi Gym*",
        "",
        "*Payment Successful*",
        "",
        "*Name:* R. Vijay Krishna",
        "*Date:* 09/09/2026",
        "*Expiry:* 09/10/2026",
        "*Time:* 4:41 PM",
        "*Days Left:* 11 days",
        "*Status:* ACTIVE",
        "*Payment:* ₹ 1,500",
        "*Payment Status:* PAID",
        "",
        "Thank you for your payment! 💪",
        "— *Maruthi Gym*",
      ].join("\n"),
    );
  });

  it("carries the green success indicator at the top and the gym name twice", () => {
    const message = buildReceiptMessage(data);
    expect(message.startsWith("🟢 *Maruthi Gym*")).toBe(true);
    expect(message.endsWith("— *Maruthi Gym*")).toBe(true);
  });
});

describe("buildReceiptTemplateParameters", () => {
  it("emits the nine placeholders in the order the Meta template declares them", () => {
    const data = buildReceiptData(makePayment(), makeStudent(), {
      now: new Date("2026-09-28T00:00:00"),
      gymName: "Maruthi Gym",
    });
    expect(buildReceiptTemplateParameters(data)).toEqual([
      "Maruthi Gym", // {{1}} gym name, reused in the footer
      "R. Vijay Krishna", // {{2}} student name
      "09/09/2026", // {{3}} payment date
      "09/10/2026", // {{4}} expiry date
      "4:41 PM", // {{5}} payment time
      "11 days", // {{6}} days left
      "ACTIVE", // {{7}} membership status
      "₹ 1,500", // {{8}} amount
      "PAID", // {{9}} payment status
    ]);
  });
});
