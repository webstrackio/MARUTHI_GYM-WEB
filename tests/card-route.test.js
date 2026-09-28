import { describe, expect, it, vi, beforeEach } from "vitest";

// The card endpoint is the one route that is deliberately unauthenticated and
// publicly reachable, because WhatsApp fetches it from the internet. So its
// behaviour is pinned down here: which tokens it accepts, what it returns for
// each failure, and - the reason it is keyed on a token at all - that a payment
// id is never enough to get a card.
const payments = {
  "tok-abc": {
    id: 42,
    date: "2026-09-09",
    createdAt: "2026-09-09T11:11:00.000Z",
    expiryDate: "2026-10-09",
    studentId: 7,
    amount: 1500,
    paymentMethod: "cash",
    whatsappCardToken: "tok-abc",
  },
};
const students = { 7: { id: 7, name: "R. Vijay Krishna", phone: "9876543210", expiryDate: "2026-10-09" } };

const getPaymentByCardToken = vi.fn(async (token) => payments[token]);
const getStudentById = vi.fn(async (id) => students[id] ?? null);

vi.mock("../server/lib/storage.js", () => ({
  storage: { getPaymentByCardToken, getStudentById },
}));

const { default: handler } = await import("../api/whatsapp/card/[token].js");
const { decodePng } = await import("./png.js");

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}
const call = async (query, method = "GET") => {
  const res = makeRes();
  await handler({ method, query, params: {} }, res);
  return res;
};

describe("GET the card image", () => {
  beforeEach(() => {
    getPaymentByCardToken.mockClear();
    getStudentById.mockClear();
  });

  it("returns a real PNG for a valid token", async () => {
    const res = await call({ token: "tok-abc" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.body.subarray(1, 4).toString("ascii")).toBe("PNG");
    const img = decodePng(res.body);
    expect(img.width).toBe(720);
  });

  it("strips the .png suffix, because Vercel leaves it on the last path segment", async () => {
    // WhatsApp is given /api/whatsapp/card/<uuid>.png, and the router hands the
    // whole "uuid.png" to the handler. Without the trim, every real request 404s.
    const res = await call({ token: "tok-abc.png" });
    expect(res.statusCode).toBe(200);
    expect(getPaymentByCardToken).toHaveBeenCalledWith("tok-abc");
  });

  it("declares a content length that matches the bytes it sends", async () => {
    const res = await call({ token: "tok-abc" });
    expect(Number(res.headers["Content-Length"])).toBe(res.body.length);
  });

  it("caches immutably, because a payment's card never changes", async () => {
    const res = await call({ token: "tok-abc" });
    expect(res.headers["Cache-Control"]).toContain("immutable");
  });

  it("404s an unknown token rather than rendering an empty card", async () => {
    const res = await call({ token: "not-a-real-token" });
    expect(res.statusCode).toBe(404);
    // A 200 with a placeholder would tell the owner a receipt went out for a
    // payment that does not exist.
    expect(Buffer.isBuffer(res.body)).toBe(false);
  });

  it("400s a missing token", async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
  });

  it("refuses methods other than GET", async () => {
    const res = await call({ token: "tok-abc" }, "POST");
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toContain("GET");
  });
});

describe("the card URL cannot be guessed", () => {
  beforeEach(() => {
    getPaymentByCardToken.mockClear();
  });

  it("does not accept a payment id in place of a token", async () => {
    // Payment 42 is the first row in the table. If the route accepted ids, a
    // student could walk 1, 2, 3 and read everyone's name, amount and expiry.
    const res = await call({ token: "42" });
    expect(res.statusCode).toBe(404);
    expect(getPaymentByCardToken).toHaveBeenCalledWith("42");
  });

  it("looks the payment up only by the unguessable token", async () => {
    await call({ token: "tok-abc" });
    expect(getPaymentByCardToken).toHaveBeenCalledTimes(1);
    expect(getPaymentByCardToken.mock.calls[0][0]).toBe("tok-abc");
  });
});

describe("failure to reach the database", () => {
  it("500s instead of pretending the receipt does not exist", async () => {
    getPaymentByCardToken.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await call({ token: "tok-abc" });
    // A 404 here would tell Meta the card is gone, and a 200 with a blank card
    // would tell the owner a receipt was produced. Neither is true.
    expect(res.statusCode).toBe(500);
  });
});
