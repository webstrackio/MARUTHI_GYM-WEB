import {
  DEFAULT_RECEIPT_TEMPLATE,
  DEFAULT_GYM_NAME as DEFAULT_RECEIPT_GYM_NAME,
  buildReceiptData,
  buildReceiptMessage,
  buildReceiptTemplateParameters,
} from "../../shared/whatsapp-receipt.js";
import { buildReceiptSvg } from "../../shared/receipt-card.js";
import { renderCardPng } from "./card-renderer.js";

// Meta's hosted Cloud API. There is no SDK dependency: the endpoint is a single
// documented POST, so calling it directly keeps the bundle small and avoids
// pulling a library that would ship the access token somewhere unexpected.
const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v21.0";
const DEFAULT_LANGUAGE = "en";
// The Cloud API is called after the payment response has already been sent, so
// a slow or hung Meta endpoint must never hold the connection open forever.
const DEFAULT_TIMEOUT_MS = 8000;
// Rendered card width. 720px is roughly 2x a typical phone chat width, so the
// receipt stays crisp on a retina screen without being a huge download.
const CARD_RENDER_WIDTH = 720;

// Reads the server-side WhatsApp configuration from the environment. The access
// token is only ever read here, in server code - it is never bundled into the
// client and never travels over a request body. Returns a `missing` list rather
// than throwing, so the payment path can record *why* it could not send.
export function getWhatsAppConfig(env = process.env) {
  const accessToken = (env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const missing = [];
  if (!accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  return {
    accessToken,
    phoneNumberId,
    templateName: (env.WHATSAPP_TEMPLATE_NAME || "").trim() || DEFAULT_RECEIPT_TEMPLATE,
    language: (env.WHATSAPP_TEMPLATE_LANGUAGE || "").trim() || DEFAULT_LANGUAGE,
    graphVersion: (env.WHATSAPP_GRAPH_VERSION || "").trim() || DEFAULT_GRAPH_VERSION,
    gymName: (env.GYM_NAME || "").trim(),
    // "image" attaches the blue card as the template's image header. "text"
    // sends the body alone, for a text-only Meta template.
    receiptStyle: (env.WHATSAPP_RECEIPT_STYLE || "").trim().toLowerCase() === "text" ? "text" : "image",
    // Public origin of this deployment. WhatsApp fetches the card over the
    // internet, so it needs an absolute https URL - it cannot reach localhost.
    publicBaseUrl: (env.WHATSAPP_PUBLIC_BASE_URL || env.VERCEL_URL || "").trim().replace(/\/+$/, ""),
    timeoutMs: Number(env.WHATSAPP_TIMEOUT_MS) > 0 ? Number(env.WHATSAPP_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    // Test hook: with this on, the payload is built and logged exactly as it
    // would be sent, the payment is marked sent, and no network call is made.
    dryRun: env.WHATSAPP_DRY_RUN === "true",
    missing,
    configured: missing.length === 0,
  };
}

// The absolute URL WhatsApp fetches to obtain a payment's card image.
// `VERCEL_URL` is a bare host, so it needs the scheme; an explicit
// WHATSAPP_PUBLIC_BASE_URL wins so a preview deployment can be pointed elsewhere.
export function buildCardUrl(token, config) {
  if (!token || !config.publicBaseUrl) {
    return null;
  }
  const base = /^https?:\/\//i.test(config.publicBaseUrl) ? config.publicBaseUrl : `https://${config.publicBaseUrl}`;
  return `${base}/api/whatsapp/card/${token}.png`;
}

// The gym name for callers that only need the string, such as the card endpoint.
// Reads the same env var the sender does, so the card and the text body can never
// disagree about who sent the receipt.
export function getGymNameFromEnv(env = process.env) {
  return (env.GYM_NAME || "").trim() || DEFAULT_RECEIPT_GYM_NAME;
}

// Decides how the receipt is presented, and only claims the image style when a
// card genuinely rendered.
//
// This is deliberately not optimistic. A template image header is fetched by
// WhatsApp at delivery time, not at send time, so sending a link to a card that
// fails to render would produce a delivered message with a broken image in it -
// and the send would still be recorded as `sent`. Rendering once here means the
// style is only `image` when the bytes really exist, and otherwise the receipt
// degrades to the text body that is already correct on its own.
export async function resolveReceiptStyle(payment, data, config, options = {}) {
  if (config.receiptStyle === "text") {
    return { style: "text", cardUrl: null, reason: "WHATSAPP_RECEIPT_STYLE=text" };
  }
  const cardUrl = buildCardUrl(payment?.whatsappCardToken, config);
  if (!cardUrl) {
    return { style: "text", cardUrl: null, reason: "No public base URL or card token" };
  }
  try {
    const render = options.renderImpl ?? renderCardPng;
    await render(buildReceiptSvg(data), { width: CARD_RENDER_WIDTH });
    return { style: "image", cardUrl, reason: null };
  } catch (error) {
    console.warn(`[whatsapp] card render failed, falling back to text: ${error.message}`);
    return { style: "text", cardUrl: null, reason: error.message };
  }
}

// Strips the access token out of anything that is about to be written to a log
// or stored on the payments row, so a failed send can be diagnosed without
// leaking the credential into log aggregators or the database.
export function redactSecrets(text, config) {
  let out = String(text ?? "");
  const secrets = [config?.accessToken, config?.phoneNumberId].filter(Boolean);
  for (const secret of secrets) {
    out = out.split(secret).join("***");
  }
  return out;
}

export class WhatsAppApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Low-level Cloud API call. Throws WhatsAppApiError on any non-2xx response, a
// network fault, or a timeout. Callers are expected to catch.
//
// `cardUrl`, when present, becomes the template's IMAGE header - that is the only
// way Meta lets a business-initiated message carry a picture, and therefore the
// only way the blue card can be shown. The text detail still rides along in the
// body, so the message is readable even if the image fails to load on the
// student's phone or data connection.
export async function sendTemplateMessage({ to, parameters, cardUrl, config, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = `${GRAPH_HOST}/${config.graphVersion}/${config.phoneNumberId}/messages`;

  const components = [];
  if (cardUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: cardUrl } }],
    });
  }
  components.push({
    type: "body",
    parameters: parameters.map((text) => ({ type: "text", text: String(text) })),
  });

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.language },
      components,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new WhatsAppApiError(`WhatsApp request timed out after ${config.timeoutMs}ms`);
    }
    throw new WhatsAppApiError(`WhatsApp request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiError = payload?.error;
    throw new WhatsAppApiError(
      apiError?.message || `WhatsApp API responded with HTTP ${response.status}`,
      { status: response.status, code: apiError?.code, details: payload ?? raw.slice(0, 500) },
    );
  }

  return {
    messageId: payload?.messages?.[0]?.id || payload?.messaging_id || null,
    raw: payload,
  };
}

// Builds the receipt for a payment without sending anything. Used by the manual
// "preview receipt" path and by the sender itself.
export function previewPaymentReceipt(payment, student, options = {}) {
  const config = options.config ?? getWhatsAppConfig();
  const data = buildReceiptData(payment, student, {
    now: options.now,
    gymName: config.gymName,
  });
  return {
    config,
    data,
    message: buildReceiptMessage(data),
    parameters: buildReceiptTemplateParameters(data),
  };
}

// Sends the receipt for one payment and records the outcome on the payment row.
//
// This function NEVER throws and NEVER rejects. The payment is already saved and
// already reported as successful by the time it runs, so a WhatsApp problem of
// any kind - missing credentials, an unapproved template, a Meta outage, a
// timeout, a rejected number - is recorded on the row and returned as data.
// Every failure is retryable by the owner through the resend button.
//
// Options:
//   storage  - object with getPaymentById / getStudentById /
//              claimPaymentReceipt / markPaymentReceipt
//   force    - true for a deliberate manual resend, which bypasses the
//              already-sent guard. Automatic callers leave it false.
//   now      - injectable clock, used only for the "Days Left" countdown.
export async function deliverPaymentReceipt(paymentId, options = {}) {
  const { storage, force = false, now, fetchImpl } = options;
  const config = options.config ?? getWhatsAppConfig();
  const outcome = (status, extra = {}) => ({ ok: status === "sent", status, ...extra });

  if (!storage) {
    return outcome("failed", { error: "No storage provided" });
  }

  let payment;
  try {
    payment = await storage.getPaymentById(paymentId);
  } catch (error) {
    console.error(`[whatsapp] failed to load payment ${paymentId}:`, error);
    return outcome("failed", { error: "Could not load the payment" });
  }
  if (!payment) {
    return outcome("skipped", { error: "Payment not found" });
  }

  let student = null;
  try {
    student = payment.studentId ? await storage.getStudentById(payment.studentId) : null;
  } catch (error) {
    console.error(`[whatsapp] failed to load student ${payment.studentId}:`, error);
  }

  const preview = previewPaymentReceipt(payment, student, { config, now });
  const { data, message, parameters } = preview;
  // A payment recorded before the card column existed has no token, so mint one
  // on the fly. A failure here is not fatal - it just means the text receipt, so
  // the column read is kept off the critical path.
  const cardToken = payment.whatsappCardToken ?? (await mintCardToken(storage, paymentId, payment));
  // Resolved before the claim is taken, so the render never holds the row in the
  // in-flight "sending" state.
  const { style, cardUrl } = await resolveReceiptStyle(
    { ...payment, whatsappCardToken: cardToken },
    data,
    config,
    { renderImpl: options.renderImpl },
  );

  // Duplicate guard. The claim is an atomic compare-and-set in the database, so
  // two concurrent triggers of the same payment cannot both win: the loser gets
  // 0 rows back and returns without sending anything. This holds even if the
  // browser double-submits or the owner taps Record twice.
  let claim;
  try {
    claim = await storage.claimPaymentReceipt(paymentId, { force });
  } catch (error) {
    console.error(`[whatsapp] failed to claim payment ${paymentId}:`, error);
    return outcome("failed", { error: "Could not reserve the receipt for sending" });
  }
  if (!claim) {
    // Only reachable without `force`: the allowlist guard rejected the update
    // because the row is already `sent` (a duplicate trigger) or `sending`
    // (a concurrent trigger still in flight). Either way nothing is sent.
    const alreadySent = payment.whatsappStatus === "sent";
    return outcome(alreadySent ? "sent" : "skipped", {
      duplicate: true,
      error: alreadySent
        ? "Receipt already sent"
        : "A receipt for this payment is already being sent",
      messageId: payment.whatsappMessageId ?? null,
      to: data.to,
    });
  }

  if (!config.configured) {
    const reason = `WhatsApp not configured (missing ${config.missing.join(", ")})`;
    console.warn(`[whatsapp] ${reason} - payment ${paymentId} marked skipped`);
    await markSafely(storage, paymentId, { status: "skipped", error: reason });
    return outcome("skipped", { error: reason, to: data.to, message });
  }

  if (!data.to) {
    const reason = `No usable WhatsApp number for student ${payment.studentId}`;
    console.warn(`[whatsapp] ${reason} - payment ${paymentId} marked skipped`);
    await markSafely(storage, paymentId, { status: "skipped", error: reason });
    return outcome("skipped", { error: reason, to: null, message });
  }

  if (config.dryRun) {
    console.log(
      `[whatsapp] DRY RUN for payment ${paymentId} -> ${data.to} via template "${config.templateName}":\n${message}`,
    );
    // Recorded as "skipped", not "sent". Nothing left this server, so marking it
    // sent would put a lie in the database and in the owner's payment history -
    // the exact failure this feature is supposed to prevent. "skipped" is also in
    // RETRYABLE_RECEIPT_STATUSES, so turning dry-run off and hitting Resend
    // delivers it for real.
    const reason = "Dry run: WhatsApp is not configured to send, so no message left the server";
    await markSafely(storage, paymentId, { status: "skipped", error: reason, style });
    return outcome("skipped", {
      to: data.to,
      message,
      style,
      cardUrl,
      dryRun: true,
      error: reason,
    });
  }

  try {
    const { messageId } = await sendTemplateMessage({
      to: data.to,
      parameters,
      cardUrl: style === "image" ? cardUrl : null,
      config,
      fetchImpl,
    });
    await markSafely(storage, paymentId, { status: "sent", messageId, style });
    console.log(
      `[whatsapp] receipt sent for payment ${paymentId} to ${data.to} as ${style} (${messageId ?? "no id"})`,
    );
    return outcome("sent", { messageId: messageId ?? null, to: data.to, message, style, cardUrl });
  } catch (error) {
    const reason = redactSecrets(error.message, config).slice(0, 500);
    console.error(`[whatsapp] receipt FAILED for payment ${paymentId} (${data.to}):`, reason);
    await markSafely(storage, paymentId, { status: "failed", error: reason, style });
    return outcome("failed", { error: reason, to: data.to, message, style });
  }
}

// Writing the outcome must not be able to turn a successful WhatsApp send into a
// thrown error at the call site, so a failure here is logged and swallowed.
async function markSafely(storage, paymentId, { status, messageId = null, error = null, style = null }) {
  try {
    await storage.markPaymentReceipt(paymentId, { status, messageId, error, style });
  } catch (writeError) {
    console.error(`[whatsapp] could not record "${status}" on payment ${paymentId}:`, writeError);
  }
}

// Backfills the card token for a payment that predates the column. Returns null
// if the storage layer cannot do it, which downgrades the receipt to text rather
// than failing a payment that was already saved successfully.
async function mintCardToken(storage, paymentId, payment) {
  if (typeof storage.ensurePaymentCardToken !== "function") return null;
  try {
    return (await storage.ensurePaymentCardToken(paymentId)) ?? null;
  } catch (error) {
    console.warn(`[whatsapp] could not mint a card token for payment ${paymentId}: ${error.message}`);
    return null;
  }
}
