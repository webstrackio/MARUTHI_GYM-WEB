// Test doubles for the receipt sender.
//
// The important one is `claimPaymentReceipt`: it reimplements the compare-and-set
// that `server/lib/storage.js` performs in SQL, including the behaviour that
// makes it atomic. Two concurrent callers each get the row back at most once, and
// the second caller is rejected the moment the first one moves the row to
// "sending" - the exact race a `status <> 'sent'` guard would get wrong.

export function createFakeStorage({ payment, student, onClaim } = {}) {
  const state = {
    payment: payment ? { ...payment } : null,
    student: student ? { ...student } : null,
    marks: [],
    claims: [],
  };

  return {
    state,
    async getPaymentById(id) {
      return state.payment && state.payment.id === id ? { ...state.payment } : undefined;
    },
    async getStudentById(id) {
      return state.student && state.student.id === id ? { ...state.student } : null;
    },
    async claimPaymentReceipt(id, { force = false } = {}) {
      if (!state.payment || state.payment.id !== id) return null;
      const current = state.payment.whatsappStatus ?? "pending";
      const allowed = ["pending", "failed", "skipped"];
      if (!force && !allowed.includes(current)) {
        state.claims.push({ id, force, granted: false, current });
        return null;
      }
      state.payment.whatsappStatus = "sending";
      state.payment.whatsappError = null;
      state.claims.push({ id, force, granted: true, current });
      onClaim?.({ id, force, current });
      return { ...state.payment };
    },
    async markPaymentReceipt(id, { status, messageId = null, error = null, style = null }) {
      state.marks.push({ id, status, messageId, error, style });
      if (state.payment && state.payment.id === id) {
        state.payment.whatsappStatus = status;
        state.payment.whatsappMessageId = messageId;
        state.payment.whatsappError = error;
        // `style` is only written when the caller knows which presentation was
        // actually delivered; a "skipped because not configured" outcome has no
        // style because nothing was presented.
        if (style) state.payment.whatsappStyle = style;
        if (status === "sent") state.payment.whatsappSentAt = new Date("2026-09-28T00:00:00Z");
      }
      return { ...state.payment };
    },
    async getPaymentByCardToken(token) {
      return state.payment && state.payment.whatsappCardToken === token ? { ...state.payment } : undefined;
    },
    async ensurePaymentCardToken(id) {
      if (!state.payment || state.payment.id !== id) return null;
      if (state.payment.whatsappCardToken) return state.payment.whatsappCardToken;
      // Mirrors the real conditional update: a row that already has a token
      // keeps it, so two concurrent resends end up on the same URL.
      state.payment.whatsappCardToken ??= "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      return state.payment.whatsappCardToken;
    },
  };
}

// A payment row as it comes back from the database: `date` is a calendar date,
// `createdAt` is the immutable "paid at" instant, and the receipt columns are
// at their defaults.
export function makePayment(overrides = {}) {
  return {
    id: 42,
    tokenNumber: "TKN-1758000000000",
    date: "2026-09-09",
    startDate: "2026-09-09",
    expiryDate: "2026-10-09",
    studentId: 7,
    registerNo: "101",
    studentName: "R. Vijay Krishna",
    duration: 1,
    amount: 1500,
    paymentMethod: "cash",
    createdAt: "2026-09-09T11:11:00.000Z", // 4:41 PM IST
    whatsappStatus: "pending",
    whatsappMessageId: null,
    whatsappSentAt: null,
    whatsappError: null,
    // Set on every payment the API creates; the public card URL is keyed on it.
    whatsappCardToken: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

export function makeStudent(overrides = {}) {
  return {
    id: 7,
    registerNo: "101",
    name: "R. Vijay Krishna",
    phone: "9876543210",
    address: "Main Road",
    joinDate: "2026-01-01",
    expiryDate: "2026-10-09",
    batch: "morning",
    ...overrides,
  };
}

export function makeConfig(overrides = {}) {
  return {
    accessToken: "test-token",
    phoneNumberId: "1234567890",
    templateName: "gym_payment_receipt",
    language: "en",
    graphVersion: "v21.0",
    gymName: "Maruthi Gym",
    // No public base URL by default, so the default config resolves to the text
    // style. Tests that exercise the image card opt in explicitly.
    receiptStyle: "image",
    publicBaseUrl: "",
    timeoutMs: 50,
    dryRun: false,
    missing: [],
    configured: true,
    ...overrides,
  };
}

// Records every Cloud API call and returns a scripted response.
export function makeFetchMock({ ok = true, status = 200, body, messageId = "wamid.HBgNNTUxMTk1OTk1OTkVAgARGBI5QTNDQTU5QkI1NUNBMzk1Q0Q2QzlBMDU5" } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      authorization: init.headers.Authorization,
      body: JSON.parse(init.body),
    });
    return {
      ok,
      status,
      text: async () => JSON.stringify(body ?? (ok ? { messages: [{ id: messageId }] } : { error: { message: "boom", code: 131009 } })),
    };
  };
  impl.calls = calls;
  return impl;
}
