const PASSKEY_STORAGE_KEY = "gymdesk_passkeys";
export function getPasskeyIds() {
    try {
        const raw = localStorage.getItem(PASSKEY_STORAGE_KEY);
        return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    }
    catch (e) {
        return [];
    }
}
function savePasskeyIds(ids) {
    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(ids));
}
export function clearPasskeys() {
    localStorage.removeItem(PASSKEY_STORAGE_KEY);
}
function toBase64Url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
function fromBase64Url(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer;
}
export async function isDeviceUnlockAvailable() {
    try {
        if (!window.PublicKeyCredential || !navigator.credentials)
            return false;
        if (!window.isSecureContext)
            return false;
        return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    catch (e) {
        return false;
    }
}
export async function registerDeviceUnlock(ownerName, gymName) {
    const credential = await navigator.credentials.create({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: gymName || "GymDesk" },
            user: {
                id: new TextEncoder().encode("gymdesk-owner"),
                name: ownerName || "gym-owner",
                displayName: `${gymName || "Gym"} Owner`,
            },
            pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                residentKey: "preferred",
                userVerification: "required",
            },
            timeout: 60000,
            attestation: "none",
        },
    });
    if (!credential)
        return false;
    const id = toBase64Url(credential.rawId);
    const ids = getPasskeyIds();
    if (!ids.includes(id)) {
        ids.push(id);
        savePasskeyIds(ids);
    }
    return true;
}
export async function unlockWithDevice() {
    const ids = getPasskeyIds();
    if (ids.length === 0 || !window.PublicKeyCredential)
        return false;
    try {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                allowCredentials: ids.map((id) => ({
                    type: "public-key",
                    id: fromBase64Url(id),
                })),
                userVerification: "required",
                timeout: 60000,
            },
        });
        return Boolean(assertion && ids.includes(toBase64Url(assertion.rawId)));
    }
    catch (e) {
        return false;
    }
}
