import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import paymentHandler from "../api/payments/index.js";

// The route imports the real storage module, which opens a Postgres pool at
// import time. `vi.mock` replaces it before the handler is loaded, so no
// connection is ever attempted.
//
// `vi.mock` calls are hoisted above every top-level statement, so the mocked
// objects have to be created inside `vi.hoisted` to exist by the time the
// factory runs.
const { storageMock, receiptMock } = vi.hoisted(() => {
  const storage = {
    getStudentById: vi.fn(),
    createPayment: vi.fn(),
    updateStudent: vi.fn(),
    getPayments: vi.fn(),
    getPaymentById: vi.fn(),
    claimPaymentReceipt: vi.fn(),
    markPaymentReceipt: vi.fn(),
  };
  const receipt = vi.fn(async () => ({ ok: true, status: "sent", to: "919876543210" }));
  return { storageMock: storage, receiptMock: receipt };
});

vi.mock("../server/lib/storage.js", () => ({ storage: storageMock }));
vi.mock("../server/lib/whatsapp.js", () => ({ deliverPaymentReceipt: receiptMock }));

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
  globalThis.fetch = (url) => {
    throw new Error(`Unexpected real network call to ${url}`);
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/payments - WhatsApp trigger", () => {
  it("sends the receipt once the payment is saved", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: validBody }, res);

    expect(res.statusCode).toBe(201);
    expect(storageMock.createPayment).toHaveBeenCalledOnce();
    // The send happens after the row exists, and is handed the new id.
    expect(receiptMock).toHaveBeenCalledWith(42, expect.objectContaining({ storage: storageMock }));
  });

  it("mints a card token on every new payment", async () => {
    // Without a token the public card URL cannot be built, so the receipt would
    // silently fall back to text on every single payment.
    await paymentHandler({ method: "POST", body: validBody }, makeRes());

    const saved = storageMock.createPayment.mock.calls[0][0];
    expect(saved.whatsappCardToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("mints a different token per payment, so one card URL cannot serve two receipts", async () => {
    await paymentHandler({ method: "POST", body: validBody }, makeRes());
    await paymentHandler({ method: "POST", body: validBody }, makeRes());

    const [first, second] = storageMock.createPayment.mock.calls.map((c) => c[0].whatsappCardToken);
    expect(first).not.toBe(second);
  });

  it("ignores a card token supplied by the client", async () => {
    // The token decides who can read a card. A client that chose its own could
    // collide with another payment's URL, so it must come from the server only.
    await paymentHandler(
      { method: "POST", body: { ...validBody, whatsappCardToken: "attacker-chosen", whatsappStatus: "sent" } },
      makeRes(),
    );

    const saved = storageMock.createPayment.mock.calls[0][0];
    expect(saved.whatsappCardToken).not.toBe("attacker-chosen");
    expect(saved.whatsappStatus).toBeUndefined();
  });

  it("sends nothing when the student does not exist", async () => {
    storageMock.getStudentById.mockResolvedValue(undefined);
    const res = makeRes();

    await paymentHandler({ method: "POST", body: validBody }, res);

    expect(res.statusCode).toBe(404);
    expect(storageMock.createPayment).not.toHaveBeenCalled();
    expect(receiptMock).not.toHaveBeenCalled();
  });

  it("sends nothing when validation fails", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, amount: undefined } }, res);

    expect(res.statusCode).toBe(400);
    expect(storageMock.createPayment).not.toHaveBeenCalled();
    expect(receiptMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the duration is out of range", async () => {
    const res = makeRes();
    await paymentHandler({ method: "POST", body: { ...validBody, duration: 0 } }, res);

    expect(res.statusCode).toBe(400);
    expect(receiptMock).not.toHaveBeenCalled();
  });

  it("still returns 201 and saves the payment when the send throws", async () => {
    receiptMock.mockRejectedValueOnce(new Error("Meta exploded"));
    const res = makeRes();

    await paymentHandler({ method: "POST", body: validBody }, res);

    // The payment succeeded; only the receipt failed. The owner must not see
    // this as a payment failure.
    expect(res.statusCode).toBe(201);
    expect(storageMock.createPayment).toHaveBeenCalledOnce();
  });

  it("sends nothing for a GET", async () => {
    storageMock.getPayments.mockResolvedValue([]);
    const res = makeRes();

    await paymentHandler({ method: "GET" }, res);

    expect(res.body).toEqual([]);
    expect(receiptMock).not.toHaveBeenCalled();
  });
});
