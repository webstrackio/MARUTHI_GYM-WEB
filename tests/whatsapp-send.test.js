import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverPaymentReceipt,
  getWhatsAppConfig,
  redactSecrets,
  sendTemplateMessage,
} from "../server/lib/whatsapp.js";
import { createFakeStorage, makeConfig, makeFetchMock, makePayment, makeStudent } from "./helpers.js";

const NOW = new Date("2026-09-28T00:00:00");

// A fetch that must never be called. Installed globally so a regression that
// reaches the real network fails the test instead of quietly sending a message.
function forbiddenFetch(url) {
  throw new Error(`Unexpected real network call to ${url}`);
}

beforeEach(() => {
  globalThis.fetch = forbiddenFetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getWhatsAppConfig", () => {
  it("reports every missing variable instead of throwing", () => {
    const config = getWhatsAppConfig({});
    expect(config.configured).toBe(false);
    expect(config.missing).toEqual(["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    expect(config.templateName).toBe("gym_payment_receipt");
    expect(config.language).toBe("en");
  });

  it("is configured once both credentials are present", () => {
    const config = getWhatsAppConfig({
      WHATSAPP_ACCESS_TOKEN: "t",
      WHATSAPP_PHONE_NUMBER_ID: "p",
      GYM_NAME: "Maruthi Gym",
    });
    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.gymName).toBe("Maruthi Gym");
  });
});

describe("redactSecrets", () => {
  it("removes the access token and phone number id from a message", () => {
    const config = makeConfig();
    const redacted = redactSecrets("failed for 1234567890 using test-token", config);
    expect(redacted).toBe("failed for *** using ***");
    expect(redacted).not.toContain("test-token");
  });
});

describe("deliverPaymentReceipt - success path", () => {
  it("sends the receipt and records the message id on the payment", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.to).toBe("919876543210");
    expect(result.messageId).toBe("wamid.HBgNNTUxMTk1OTk1OTkVAgARGBI5QTNDQTU5QkI1NUNBMzk1Q0Q2QzlBMDU5");
    expect(storage.state.payment.whatsappStatus).toBe("sent");
    expect(storage.state.payment.whatsappSentAt).toBeInstanceOf(Date);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("calls the Cloud API on the phone number id with the token in the header only", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    const call = fetchImpl.calls[0];
    expect(call.url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(call.method).toBe("POST");
    expect(call.authorization).toBe("Bearer test-token");
    // The token must never appear in a URL that could be logged by a proxy.
    expect(call.url).not.toContain("test-token");
  });

  it("sends the student's own number, never a fixed one", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent({ phone: "9000000001" }) });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(fetchImpl.calls[0].body.to).toBe("919000000001");
    expect(result.to).toBe("919000000001");
  });

  it("fills the template with the stored payment date, not the current date", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    const { parameters } = fetchImpl.calls[0].body.template.components[0];
    // Sent on 28/09/2026 for a payment taken on 09/09/2026. The receipt must
    // still say 09/09/2026.
    expect(parameters[2].text).toBe("09/09/2026");
    expect(parameters[1].text).toBe("R. Vijay Krishna");
  });

  it("uses the payment's stored time, not the current time", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    // payment.createdAt is 2026-09-09T11:11Z = 4:41 PM IST. The wall clock at
    // send time was 00:00 UTC on the 28th.
    expect(fetchImpl.calls[0].body.template.components[0].parameters[4].text).toBe("4:41 PM");
  });

  it("reuses the stored date and time when an old payment is re-sent", async () => {
    const storage = createFakeStorage({
      payment: makePayment({ id: 5, date: "2026-03-02", createdAt: "2026-03-02T04:05:00.000Z", expiryDate: "2026-04-01" }),
      student: makeStudent({ expiryDate: "2026-04-01" }),
    });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(5, { storage, config: makeConfig(), now: NOW, fetchImpl, force: true });

    const { parameters } = fetchImpl.calls[0].body.template.components[0];
    expect(parameters[2].text).toBe("02/03/2026");
    expect(parameters[3].text).toBe("01/04/2026");
    expect(parameters[4].text).toBe("9:35 AM");
    // The countdown is the one live figure, exactly as on the website card.
    expect(parameters[5].text).toBe("0 days");
    expect(parameters[6].text).toBe("EXPIRED");
    expect(result.ok).toBe(true);
  });

  it("reports EXPIRED status for a lapsed membership", async () => {
    const storage = createFakeStorage({
      payment: makePayment({ expiryDate: "2026-09-01" }),
      student: makeStudent({ expiryDate: "2026-09-01" }),
    });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(fetchImpl.calls[0].body.template.components[0].parameters[6].text).toBe("EXPIRED");
  });
});

describe("deliverPaymentReceipt - failure never breaks the payment", () => {
  it("records a Meta-side error without throwing", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock({ ok: false, status: 400, body: { error: { message: "Template not approved", code: 132001 } } });

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Template not approved");
    expect(storage.state.marks.at(-1)).toMatchObject({ status: "failed", error: "Template not approved" });
  });

  it("survives a network error and keeps the token out of the stored message", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED using test-token");
    };

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(storage.state.payment.whatsappError).not.toContain("test-token");
  });

  it("skips without sending when credentials are missing, and says which ones", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig({ configured: false, missing: ["WHATSAPP_ACCESS_TOKEN"] }), now: NOW, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(fetchImpl.calls).toHaveLength(0);
    expect(storage.state.payment.whatsappStatus).toBe("skipped");
  });

  it("skips without sending when the student has no usable number", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent({ phone: "" }) });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(result.status).toBe("skipped");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("skips cleanly when the payment does not exist", async () => {
    const storage = createFakeStorage({ payment: null, student: null });
    const result = await deliverPaymentReceipt(999, { storage, config: makeConfig(), now: NOW });
    expect(result.status).toBe("skipped");
    expect(result.error).toBe("Payment not found");
  });

  it("still records the send when the student row has been deleted", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: null });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("No usable WhatsApp number");
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe("deliverPaymentReceipt - duplicate protection", () => {
  it("does not send twice when the same payment is triggered again", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });
    const second = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(fetchImpl.calls).toHaveLength(1);
    expect(second.duplicate).toBe(true);
    expect(second.error).toBe("Receipt already sent");
  });

  it("grants the claim to only one of two concurrent triggers", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();
    // Slow the first send down so the second trigger genuinely overlaps it.
    const slowFetch = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fetchImpl(...args);
    };

    const [first, second] = await Promise.all([
      deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl: slowFetch }),
      deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl: slowFetch }),
    ]);

    expect(fetchImpl.calls).toHaveLength(1);
    expect([first.status, second.status].filter((s) => s === "sent")).toHaveLength(1);
    expect(storage.state.claims.filter((c) => c.granted)).toHaveLength(1);
  });

  it("rejects a second trigger while the first is still in flight", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    // Claim the row without finishing, as a crashed process would leave it.
    await storage.claimPaymentReceipt(42);
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });

    expect(fetchImpl.calls).toHaveLength(0);
    expect(result.duplicate).toBe(true);
    expect(result.error).toContain("already being sent");
  });

  it("retries automatically after a failure, because 'failed' is retryable", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const failing = makeFetchMock({ ok: false, status: 500, body: { error: { message: "Meta outage" } } });
    const working = makeFetchMock();

    const first = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl: failing });
    const second = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl: working });

    expect(first.status).toBe("failed");
    expect(second.status).toBe("sent");
    expect(working.calls).toHaveLength(1);
  });

  it("sends again on a forced resend, even after a successful send", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl });
    const resend = await deliverPaymentReceipt(42, { storage, config: makeConfig(), now: NOW, fetchImpl, force: true });

    expect(fetchImpl.calls).toHaveLength(2);
    expect(resend.status).toBe("sent");
  });
});

describe("deliverPaymentReceipt - dry run", () => {
  it("never calls Meta and does not claim the receipt was sent", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ dryRun: true }),
      now: NOW,
      fetchImpl,
    });

    expect(result.dryRun).toBe(true);
    expect(fetchImpl.calls).toHaveLength(0);
    // The point of the test: a dry run must not write "sent". Nothing was
    // delivered, so the database and the owner's payment history must say so.
    // Writing "sent" here is how a business ends up believing students received
    // receipts that were never sent.
    expect(result.status).toBe("skipped");
    expect(storage.state.payment.whatsappStatus).toBe("skipped");
    expect(storage.state.payment.whatsappSentAt).toBeNull();
    expect(result.error).toMatch(/dry run/i);
  });

  it("leaves the receipt retryable so a real send can follow", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ dryRun: true }),
      now: NOW,
      fetchImpl: makeFetchMock(),
    });

    // "skipped" is in RETRYABLE_RECEIPT_STATUSES, so the owner can turn dry-run
    // off and hit Resend without touching the database by hand.
    const resend = await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig(),
      now: NOW,
      fetchImpl: makeFetchMock(),
    });
    expect(resend.status).toBe("sent");
  });
});

describe("deliverPaymentReceipt - the blue card is really attached", () => {
  const cardConfig = () => makeConfig({ publicBaseUrl: "https://gym.example.com" });
  // The real renderer is exercised in tests/receipt-card.test.js against actual
  // pixels. Here it is stubbed so these tests assert the *plumbing* - which
  // component order and which URL - without re-rasterising a PNG each time.
  const okRender = async () => ({ png: Buffer.alloc(8), width: 720, height: 920 });

  it("sends the card as the template's image header, ahead of the body", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: cardConfig(), now: NOW, fetchImpl, renderImpl: okRender });

    const { components } = fetchImpl.calls[0].body.template;
    // Meta requires the header component before the body, and a header that
    // carries a picture must be typed "image" with a public `link`.
    expect(components.map((c) => c.type)).toEqual(["header", "body"]);
    expect(components[0].parameters).toEqual([
      { type: "image", image: { link: "https://gym.example.com/api/whatsapp/card/11111111-2222-3333-4444-555555555555.png" } },
    ]);
  });

  it("records the image style on the payment so support knows what was sent", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    await deliverPaymentReceipt(42, { storage, config: cardConfig(), now: NOW, fetchImpl: makeFetchMock(), renderImpl: okRender });

    expect(storage.state.payment.whatsappStatus).toBe("sent");
    expect(storage.state.payment.whatsappStyle).toBe("image");
  });

  it("keeps the text detail in the body so the message reads even if the image fails", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: cardConfig(), now: NOW, fetchImpl, renderImpl: okRender });

    const body = fetchImpl.calls[0].body.template.components[1];
    expect(body.parameters.map((p) => p.text)).toEqual([
      "Maruthi Gym",
      "R. Vijay Krishna",
      "09/09/2026",
      "09/10/2026",
      "4:41 PM",
      "11 days",
      "ACTIVE",
      "₹ 1,500",
      "PAID",
    ]);
  });

  it("adds the scheme to a bare VERCEL_URL host", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ publicBaseUrl: "my-gym.vercel.app" }),
      now: NOW,
      fetchImpl,
      renderImpl: okRender,
    });

    const header = fetchImpl.calls[0].body.template.components[0];
    // A schemeless URL is rejected by WhatsApp, which would mean a delivered
    // message with a broken image.
    expect(header.parameters[0].image.link).toMatch(/^https:\/\/my-gym\.vercel\.app\//);
  });

  it("never lets the payment id appear in the card URL", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    await deliverPaymentReceipt(42, { storage, config: cardConfig(), now: NOW, fetchImpl, renderImpl: okRender });

    const link = fetchImpl.calls[0].body.template.components[0].parameters[0].image.link;
    // Payment 42 is the first row in the table; a guessable URL would let anyone
    // walk /api/whatsapp/card/1, /2, /3 and read students' names and amounts.
    expect(link).not.toContain("/42");
  });
});

describe("deliverPaymentReceipt - falling back to text", () => {
  const cardConfig = () => makeConfig({ publicBaseUrl: "https://gym.example.com" });

  it("falls back to the text body when the card cannot be rendered", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();
    const failRender = async () => {
      throw new Error("no fonts available");
    };

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: cardConfig(),
      now: NOW,
      fetchImpl,
      renderImpl: failRender,
    });

    // A template image header is fetched by WhatsApp at *delivery* time, not at
    // send time. Sending a link to a card that cannot render would deliver a
    // message with a broken image that is still recorded as sent. Text is the
    // correct degradation.
    const { components } = fetchImpl.calls[0].body.template;
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe("body");
    expect(result.style).toBe("text");
    expect(storage.state.payment.whatsappStyle).toBe("text");
    expect(result.status).toBe("sent");
  });

  it("falls back to text when there is no public URL for WhatsApp to fetch", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ publicBaseUrl: "" }),
      now: NOW,
      fetchImpl,
      renderImpl: async () => {
        throw new Error("render should not even be attempted");
      },
    });

    expect(result.style).toBe("text");
    expect(fetchImpl.calls[0].body.template.components[0].type).toBe("body");
  });

  it("mints a card token on demand for a payment recorded before the card existed", async () => {
    // An old payment row has no token. Resending it should still produce a real
    // card rather than silently downgrading the owner to text forever.
    const storage = createFakeStorage({
      payment: makePayment({ whatsappCardToken: null }),
      student: makeStudent(),
    });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: cardConfig(),
      now: NOW,
      fetchImpl,
      renderImpl: async () => ({ png: Buffer.alloc(8), width: 720, height: 920 }),
    });

    expect(result.style).toBe("image");
    expect(storage.state.payment.whatsappCardToken).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(fetchImpl.calls[0].body.template.components[0].parameters[0].image.link).toContain(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("falls back to text when the payment has no card token and none can be minted", async () => {
    const storage = createFakeStorage({ payment: makePayment({ whatsappCardToken: null }), student: makeStudent() });
    // Stand in for a database that cannot be written to. A token that could not
    // be saved must not be used to build a URL, because the image endpoint would
    // 404 it and WhatsApp would deliver a broken picture.
    storage.ensurePaymentCardToken = async () => null;
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: cardConfig(),
      now: NOW,
      fetchImpl,
      renderImpl: async () => {
        throw new Error("render should not even be attempted");
      },
    });

    expect(result.style).toBe("text");
    expect(result.status).toBe("sent");
    expect(fetchImpl.calls[0].body.template.components[0].type).toBe("body");
  });

  it("sends text only when WHATSAPP_RECEIPT_STYLE=text, even when a card is possible", async () => {
    const storage = createFakeStorage({ payment: makePayment(), student: makeStudent() });
    const fetchImpl = makeFetchMock();

    const result = await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ publicBaseUrl: "https://gym.example.com", receiptStyle: "text" }),
      now: NOW,
      fetchImpl,
      renderImpl: async () => {
        throw new Error("render should not even be attempted");
      },
    });

    expect(result.style).toBe("text");
    expect(fetchImpl.calls[0].body.template.components).toHaveLength(1);
  });

  it("does not leave a stale style on the payment when it is skipped", async () => {
    const storage = createFakeStorage({
      payment: makePayment({ whatsappStyle: "image" }),
      student: makeStudent(),
    });

    await deliverPaymentReceipt(42, {
      storage,
      config: makeConfig({ missing: ["WHATSAPP_ACCESS_TOKEN"], configured: false }),
      now: NOW,
      fetchImpl: makeFetchMock(),
    });

    // Nothing was presented, so the previously recorded style must not be
    // presented as if this attempt had used it.
    expect(storage.state.payment.whatsappStatus).toBe("skipped");
    expect(storage.state.marks.at(-1).style).toBeNull();
  });
});

describe("sendTemplateMessage", () => {
  it("builds a template payload with one body parameter per placeholder", async () => {
    const fetchImpl = makeFetchMock();
    await sendTemplateMessage({
      to: "919876543210",
      parameters: ["a", "b", "c"],
      config: makeConfig(),
      fetchImpl,
    });

    const body = fetchImpl.calls[0].body;
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919876543210",
      type: "template",
    });
    expect(body.template.name).toBe("gym_payment_receipt");
    expect(body.template.language).toEqual({ code: "en" });
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "text", text: "c" },
    ]);
  });

  it("omits the header component entirely when no card URL is given", async () => {
    const fetchImpl = makeFetchMock();
    await sendTemplateMessage({
      to: "919876543210",
      parameters: ["a"],
      cardUrl: null,
      config: makeConfig(),
      fetchImpl,
    });

    // Meta rejects a header component with no parameters, so the header must not
    // be present at all rather than being sent empty.
    expect(fetchImpl.calls[0].body.template.components.map((c) => c.type)).toEqual(["body"]);
  });

  it("throws a typed error carrying Meta's status and code", async () => {
    const fetchImpl = makeFetchMock({ ok: false, status: 401, body: { error: { message: "Invalid OAuth token", code: 190 } } });
    await expect(
      sendTemplateMessage({ to: "919876543210", parameters: ["a"], config: makeConfig(), fetchImpl }),
    ).rejects.toMatchObject({ name: "WhatsAppApiError", status: 401, code: 190, message: "Invalid OAuth token" });
  });
});
