import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import paymentHandler from "../api/payments/index.js";

// The route imports the real storage module, which opens a Postgres pool at
// import time. `vi.mock` replaces it before the handler is loaded, so no
// connection is ever attempted.
//
// `vi.mock` calls are hoisted above every top-level statement, so the mocked
// objects have to be created inside `vi.hoisted` to exist by the time the
// factory runs.
const { storageMock } = vi.hoisted(() => {
  const storage = {
    getStudentById: vi.fn(),
    createPayment: vi.fn(),
    updateStudent: vi.fn(),
    getPayments: vi.fn(),
    getPaymentById: vi.fn(),
  };
  return { storageMock: storage };
});

vi.mock("../server/lib/storage.js", () => ({ storage: storageMock }));

const validBody = {
  date: "2026-09-28",
  studentId: 7,
  registerNo: "101",
  studentName: "R. Vijay Krishna",
  duration: 1,
  amount: 1500,
  paymentMethod: "cash",
};

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getStudentById.mockResolvedValue({ id: 7, name: "R. Vijay Krishna", phone: "9876543210", expiryDate: null });
  storageMock.createPayment.mockResolvedValue({ id: 42, ...validBody });
  storageMock.updateStudent.mockResolvedValue({ id: 7 });
  // No receipt sender is imported by the route any more, so a real network call
  // here would mean something is still reaching out after a payment.
  globalThis.fetch = (url) => {
    throw new Error(`Unexpected real network call to ${url}`);
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/payments", () => {
  it("saves the payment and returns 201", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    expect(res.statusCode).toBe(201);
    expect(storageMock.createPayment).toHaveBeenCalledOnce();
    expect(res.body.id).toBe(42);
  });

  it("makes no network call of any kind after saving", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    // globalThis.fetch throws on contact, so a reaching-out would fail the test.
    expect(res.statusCode).toBe(201);
  });

  it("persists the payment exactly as validated, with no extra columns", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    const saved = storageMock.createPayment.mock.calls[0][0];
    expect(saved).toEqual({
      ...validBody,
      tokenNumber: expect.stringMatching(/^TKN-/),
      startDate: "2026-09-28",
      expiryDate: "2026-10-28",
    });
    // Nothing receipt-shaped may be written any more.
    for (const key of Object.keys(saved)) {
      expect(key.toLowerCase()).not.toContain("whatsapp");
    }
  });

  it("adds a fixed 30 days per month, not a calendar month", async () => {
    // 1 month = 30 days, so a 31 Jan payment runs into March rather than
    // clamping to the end of February.
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, date: "2026-01-31", duration: 1 } }, res);

    expect(storageMock.createPayment.mock.calls[0][0].expiryDate).toBe("2026-03-02");
  });

  it("scales multi-month durations off the same 30-day month", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, date: "2026-09-28", duration: 2 } }, res);

    expect(storageMock.createPayment.mock.calls[0][0].expiryDate).toBe("2026-11-27");
  });

  it("uses 365 days for a full year", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, date: "2026-09-28", duration: 12 } }, res);

    expect(storageMock.createPayment.mock.calls[0][0].expiryDate).toBe("2027-09-28");
  });

  it("honours a manually entered expiry date over the calculated one", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, expiryDate: "2026-12-31" } }, res);

    expect(storageMock.createPayment.mock.calls[0][0].expiryDate).toBe("2026-12-31");
  });

  it("ignores an impossible manual expiry date and calculates one instead", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, expiryDate: "2026-02-30" } }, res);

    expect(storageMock.createPayment.mock.calls[0][0].expiryDate).toBe("2026-10-28");
  });

  it("extends from the later of the current expiry and the payment date", async () => {
    storageMock.getStudentById.mockResolvedValue({ id: 7, name: "R. Vijay Krishna", phone: "9876543210", expiryDate: "2026-11-30" });
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, date: "2026-09-28", duration: 1 } }, res);

    const saved = storageMock.createPayment.mock.calls[0][0];
    // 30 Nov is in the future, so that is the base and 1 month runs to 30 Dec.
    expect(saved.expiryDate).toBe("2026-12-30");
  });

  it("updates the student's expiry date to match the payment", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    expect(storageMock.updateStudent).toHaveBeenCalledWith(7, { expiryDate: "2026-10-28" });
  });

  it("sends nothing when the student does not exist", async () => {
    storageMock.getStudentById.mockResolvedValue(null);
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    expect(res.statusCode).toBe(404);
    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });

  it("sends nothing when validation fails", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, studentName: undefined } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Invalid payment data");
    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });

  it("rejects a duration outside 1-120 months", async () => {
    for (const duration of [0, 121, 1.5]) {
      const res = makeRes();
      await paymentHandler({ method: "POST", body: { ...validBody, duration } }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });

  it("rejects an unsupported method without saving anything", async () => {
    const res = makeRes();
    await paymentHandler({ method: "DELETE", body: validBody }, res);

    expect(res.statusCode).toBe(405);
    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });
});

describe("GET /api/payments", () => {
  it("returns the stored payments and saves nothing", async () => {
    storageMock.getPayments.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const res = makeRes();
    await paymentHandler({ method: "GET" }, res);

    // The GET branch answers with a bare res.json(), so no explicit status is
    // set and the platform applies the 200 default.
    expect(res.statusCode).toBeNull();
    expect(res.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(storageMock.createPayment).not.toHaveBeenCalled();
    expect(storageMock.updateStudent).not.toHaveBeenCalled();
  });

  it("reports a failure instead of leaking the error", async () => {
    storageMock.getPayments.mockRejectedValue(new Error("db down"));
    const res = makeRes();
    await paymentHandler({ method: "GET" }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Failed to fetch payments");
  });
});
