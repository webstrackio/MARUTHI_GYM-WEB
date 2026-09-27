export const DEFAULT_GYM_NAME = "Maruthi Gym";
const WHATSAPP_COUNTRY_CODE = "91";
export function getGymName(settings) {
    return (settings?.name || "").trim() || DEFAULT_GYM_NAME;
}
// True on phones and tablets. iPadOS reports a desktop user agent, so a coarse
// pointer is also treated as mobile.
export function isMobileDevice() {
    if (typeof navigator === "undefined")
        return false;
    if (/Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(navigator.userAgent))
        return true;
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}
// Percent-encodes the message for a WhatsApp URL. `encodeURIComponent` already
// emits UTF-8 percent-escapes, so multi-byte characters such as the emoji
// survive as %F0%9F%91%8B and are decoded back to the original character by the
// receiving app - nothing is transliterated or downgraded to ASCII.
// The only string it cannot handle is one containing an *unpaired* surrogate
// (a broken character that can reach the database from a bad import), which
// makes it throw `URIError` and would kill the whole click handler. Those are
// stripped, because the alternative is the U+FFFD replacement glyph - the very
// "�" corruption this is meant to prevent.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function encodeWhatsAppText(message) {
    return encodeURIComponent(String(message ?? "").replace(LONE_SURROGATE, ""));
}
export function openExternalUrl(href) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}
// Builds the WhatsApp share link *without* a recipient number, so WhatsApp
// opens its own share/contact-selection screen and any contact, group or chat
// can be picked. On phones api.whatsapp.com switches to the installed app and
// falls back to WhatsApp Web when the app is missing; on desktop it opens
// WhatsApp Web directly. Either way the message is pre-filled.
export function buildWhatsAppShareLink(message) {
    const text = encodeWhatsAppText(message);
    return isMobileDevice()
        ? `https://api.whatsapp.com/send?text=${text}`
        : `https://web.whatsapp.com/send/?text=${text}`;
}
// Same, without any pre-filled text. Used when several different messages are
// copied to the clipboard and each one is pasted into its own chat by hand.
export function buildWhatsAppHomeLink() {
    return isMobileDevice() ? "https://api.whatsapp.com/" : "https://web.whatsapp.com/";
}
// Opens a chat with one specific member. Phone numbers are stored as 10 local
// digits, so the country code is added here; an already-prefixed number is
// passed through untouched.
// This targets Meta's own `api.whatsapp.com/send` endpoint directly rather than
// the `wa.me/<number>` shortener. `wa.me` answers with an HTTP redirect that has
// to re-parse and re-emit the whole query string on its way to WhatsApp, and
// the percent-encoded emoji in `text` is the part that can come out mangled
// there. Going straight to the documented endpoint keeps the encoded message on
// a single hop, so the bytes WhatsApp receives are the bytes we produced.
export function buildWhatsAppDirectLink(phone, message) {
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!digits)
        return buildWhatsAppShareLink(message);
    const withCountryCode = digits.length === 10 ? `${WHATSAPP_COUNTRY_CODE}${digits}` : digits;
    return `https://api.whatsapp.com/send?phone=${withCountryCode}&text=${encodeWhatsAppText(message)}`;
}
export async function copyToClipboard(text) {
    if (!text)
        return false;
    try {
        if (navigator.clipboard?.write) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    }
    catch (_err) {
        // Fall through to the legacy path below.
    }
    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
    }
    catch (_err) {
        return false;
    }
}
// `scope` decides who a template is allowed to be sent to:
//   "expired" - only a member whose membership actually ran out
//   "pending" - only a member who registered but never paid
//   "all"     - always available
export const WHATSAPP_MESSAGE_TYPES = [
    { id: "expired", label: "Membership Expired", emoji: "🔴", scope: "expired" },
    { id: "renewal", label: "Renewal Reminder", emoji: "🟠", scope: "expired" },
    { id: "offer", label: "Special Renewal Offer", emoji: "🟢", scope: "expired" },
    { id: "pending", label: "Payment Pending", emoji: "🟡", scope: "pending" },
    { id: "custom", label: "Custom Message", emoji: "✏️", scope: "all" },
];
// `hasPayment` is the member's state, or `null` when the list must cover both
// states at once (the "message all expired members" case).
export function getWhatsAppMessageTypes(hasPayment) {
    return WHATSAPP_MESSAGE_TYPES.filter((template) => {
        if (template.scope === "all")
            return true;
        if (hasPayment === null)
            return true;
        return template.scope === (hasPayment ? "expired" : "pending");
    });
}
// Never-paid members default to the "payment pending" wording, because telling
// them their membership expired would be wrong - they never had one.
export function getDefaultWhatsAppMessageType(hasPayment) {
    return hasPayment ? "expired" : "pending";
}
// A member with no expiry date has no payment on record; every other expired
// member has one that ran out.
export function memberHasPayment(member) {
    return Boolean(member?.expiryDate);
}
export function buildWhatsAppMessage({ type, name, gymName, customMessage }) {
    const memberName = (name || "").trim() || "there";
    const gym = (gymName || "").trim() || DEFAULT_GYM_NAME;
    if (type === "custom")
        return (customMessage || "").trim();
    if (type === "pending") {
        return [
            `Hi ${memberName} 👋`,
            `You registered with ${gym} but your membership payment has not been completed yet.`,
            `If you are still interested in joining, please contact us and we can help you complete your registration. 💪`,
        ].join("\n\n");
    }
    if (type === "renewal") {
        return [
            `Hi ${memberName} 👋`,
            `Your gym membership has expired. We missed seeing you at ${gym}! 💪`,
            `Come back and continue your fitness journey with us.`,
            "Reply to this message for renewal details.",
        ].join("\n\n");
    }
    if (type === "offer") {
        return [
            `Hi ${memberName} 👋`,
            `Your ${gym} membership has expired.`,
            "🎉 We have a special renewal offer available for you.",
            "Contact us to know more and continue your fitness journey 💪",
        ].join("\n\n");
    }
    return [
        `Hi ${memberName} 👋`,
        `Your ${gym} membership has expired.`,
        "We would be happy to have you back! 💪",
        "Please contact us to renew your membership.",
        gym,
    ].join("\n\n");
}
// One message per member, each labelled with the member it belongs to, so a
// pasted block can never be sent to the wrong person.
export function buildWhatsAppBulkText(entries) {
    return entries.map((entry) => `*${entry.name}*\n${entry.message}`).join("\n\n———\n\n");
}
