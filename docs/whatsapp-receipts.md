# WhatsApp automatic payment receipts

When a payment is recorded, the student receives the receipt on WhatsApp
automatically. This uses the **official WhatsApp Business Cloud API** from the
server, so the message is delivered without anyone opening WhatsApp and pressing
send.

```
POST /api/payments
      │
      ├─ save payment row ──────────────► respond 201 to the browser
      │
      └─ (after the response) claim receipt row atomically
              │
              ├─ read the student's own saved phone number
              ├─ build the receipt from the *stored* payment values
              ├─ POST the Cloud API with the approved template
              └─ record sent / failed / skipped on the payment row
```

The send happens **after** the 201, so a WhatsApp failure can never turn a
successful payment into a failed one. It is still `await`ed, because a Vercel
serverless instance is frozen the moment the handler returns.

---

## 1. Database

The six tracking columns have to exist. Run this once against the live
database:

```bash
psql "$DATABASE_URL" -f server/migrations/001-payment-whatsapp-receipt.sql
```

Every statement is `IF NOT EXISTS`, so it is safe to re-run. This is safer than
`npm run db:push` for a production database, which can prompt to drop or
recreate things.

Until the migration is run, the new columns are missing and every payment
insert will fail. Do the migration before deploying the code.

The script ends with a `SELECT COUNT(*)` listing rows that have no card token.
Those are payments recorded before this feature existed. They still receive the
text receipt; the first Resend mints a token for them, so there is nothing to
backfill by hand.

---

## 2. Meta setup

You need a Meta Business account with a WhatsApp Business Account. The quick
path is the [Cloud API setup guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).

Then:

1. **Create the message template.** In WhatsApp Manager → Message Templates →
   Create. Category: **Utility**. Name it `gym_payment_receipt` (or set
   `WHATSAPP_TEMPLATE_NAME` to whatever you name it). Language: English.

   **Header: Image.** This is the part that makes the blue card possible. A
   business-initiated WhatsApp message cannot carry a picture any other way —
   the text body has no colour of its own. In the template editor add an
   `Image` header, leave it empty, and save. The renderer fills it in per
   recipient at send time.

   Body — the placeholder order must match `buildReceiptTemplateParameters()` in
   `shared/whatsapp-receipt.js` exactly:

   ```
   🟢 *{{1}}*

   *Payment Successful*

   *Name:* {{2}}
   *Date:* {{3}}
   *Expiry:* {{4}}
   *Time:* {{5}}
   *Days Left:* {{6}}
   *Status:* {{7}}
   *Payment:* {{8}}
   *Payment Status:* {{9}}

   Thank you for your payment! 💪
   — *{{1}}*
   ```

   - `{{1}}` is the gym name, reused in the footer
   - `{{2}}` student name · `{{3}}` payment date · `{{4}}` expiry date
   - `{{5}}` payment time · `{{6}}` days left · `{{7}}` status · `{{8}}` amount
   - `{{9}}` payment status

   The body deliberately repeats every field the card shows. On a phone with no
   data the image may not load, and the customer still gets a complete receipt.

   If you deliberately do not want images, set `WHATSAPP_RECEIPT_STYLE=text` and
   create the template **without** a header. Sending an image header to a
   text-only template is rejected by Meta, which the code avoids automatically
   by only attaching the header when the style is `image`.

2. **Wait for approval.** Utility templates are usually approved in minutes, but
   it is not instant. Until it is approved, every send fails with
   `Template not approved` (code `132001`) and the payments are marked
   `failed` — payments themselves are unaffected.

3. **Get your credentials.** WhatsApp Manager → API Setup:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Access token** → `WHATSAPP_ACCESS_TOKEN`. The temporary token in the
     dashboard expires in 24 hours; for production, create a
     [System User](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/access-tokens)
     token that does not expire.

4. **Check the card URL is reachable.** WhatsApp downloads the card from your own
   server, over the public internet, as `GET /api/whatsapp/card/<token>.png`. It
   cannot reach `localhost`. On Vercel, `VERCEL_URL` is set automatically and is
   used as the base. For a custom domain, set `WHATSAPP_PUBLIC_BASE_URL` to the
   full `https://` address. `GET /api/whatsapp/status` reports `cardRendering`
   and `cardUrlConfigured` so you can confirm both halves before recording a
   payment.

---

## 3. Environment variables

Set these in the Vercel project (Settings → Environment Variables) and in your
local `.env`:

```
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
GYM_NAME=Maruthi Gym
```

Optional: `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`,
`WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TIMEOUT_MS`, `WHATSAPP_DRY_RUN`,
`WHATSAPP_RECEIPT_STYLE` (default `image`), `WHATSAPP_PUBLIC_BASE_URL` (required
for the image style on a custom domain; Vercel's own `VERCEL_URL` is used as a
fallback).

**Never prefix these with `VITE_`.** Anything named `VITE_*` is compiled into
the browser bundle and would ship the access token to every visitor. The build
verifies this: the token is only ever read in `dist/index.js`, never in
`dist/public/`.

### Before you have credentials

The feature is safe to deploy without them. Payments record normally and each
one is marked `skipped` with the reason, and the Record Payment page shows an
amber warning naming the missing variables. The Payment History table shows a
**Receipt skipped** badge per payment with a **Send receipt** button, so nothing
is lost.

To test the whole flow first, set `WHATSAPP_DRY_RUN=true`. The receipt is built
and printed to the server console, and the payment is marked **`skipped`** — not
`sent` — because nothing was actually delivered. `skipped` is in the retryable
set, so turning dry-run off and pressing **Resend** sends it for real.

---

## 4. How delivery is tracked

Six columns on each payment:

| Column | Meaning |
| --- | --- |
| `whatsapp_status` | `pending` → `sending` → `sent` \| `failed` \| `skipped` |
| `whatsapp_message_id` | Meta's `wamid...` id, for support/debugging |
| `whatsapp_sent_at` | When the send succeeded |
| `whatsapp_error` | Why it failed, with the access token redacted |
| `whatsapp_style` | `image` when the card went out, `text` when it fell back |
| `whatsapp_card_token` | Unguessable segment of the public card URL |

Payment History shows a badge per row: **Receipt sent**, **Receipt failed**,
**Receipt skipped**, **Sending receipt** or **Receipt not sent**, plus a
**Resend** button. A sent receipt also says *Sent as image card* or *Sent as
text* underneath, so you can tell from the table whether a member really got the
blue picture or the plain-text fallback. The existing per-member "Send WhatsApp"
dialogs (`api.whatsapp.com` deep links, where you press send yourself) are
untouched.

### Why duplicates cannot happen

`claimPaymentReceipt()` moves the row from `pending`/`failed`/`skipped` to
`sending` with a single conditional `UPDATE ... WHERE id = ? AND whatsapp_status
IN (...)`, and returns the row only if it won.

The guard is an allowlist, **not** `status <> 'sent'`. Postgres re-evaluates a
`WHERE` clause against the committed row version after it releases the row lock,
so a `<> 'sent'` test would still match the freshly-written `sending` row and
let a second concurrent request through. With the allowlist, both `sending` and
`sent` fail the test, the second request gets zero rows back, and nothing is
sent. Covered by the "grants the claim to only one of two concurrent triggers"
test.

A row stuck in `sending` (process killed mid-send) is recovered by the Resend
button, which passes `force: true` and ignores the allowlist.

---

## 5. The message

### The image card

The card is built in `shared/receipt-card.js` as SVG, rendered to PNG by
`server/lib/card-renderer.js` (`@resvg/resvg-js`, a runtime dependency), and
served from `GET /api/whatsapp/card/<token>.png`. WhatsApp fetches that URL
itself and shows it above the text.

```
┌────────────────────────────────┐
│            ✓                   │  navy, white text, green accent
│          Maruthi Gym           │
│     ── PAYMENT SUCCESSFUL ──   │
│                                │
│ Name         R. Vijay Krishna  │
│ Date         09/09/2026        │
│ Expiry       09/10/2026        │
│ Time         4:41 PM           │
│ Days Left    11 days           │
│ Status       ACTIVE            │
│                                │
│ Amount Paid          ₹ 1,500   │
│      ┌──────────────────┐      │
│      │ PAYMENT STATUS:  │      │
│      │       PAID       │      │
│      └──────────────────┘      │
│                                │
│      Thank you! 💪             │
└────────────────────────────────┘
```

Rendered 720px wide (~154 KB PNG). The layout is computed first by
`layoutReceiptCard()` and then drawn to, so a long student name grows the card
instead of spilling off the bottom.

**The card URL is keyed on `whatsapp_card_token`, not the payment id.** The id
is sequential, so `/api/whatsapp/card/1` would otherwise hand out real students'
names, amounts and expiry dates to anyone counting. The token is a UUID minted
per payment, with a unique index behind it so two payments can never share a URL.

> The app has no authentication layer, so this unguessable token is the *only*
> thing protecting that route. Do not add anything sensitive to the card.

### The text body

```
🟢 *Maruthi Gym*

*Payment Successful*

*Name:* R. Vijay Krishna
*Date:* 09/09/2026
*Expiry:* 09/10/2026
*Time:* 6:41 PM
*Days Left:* 11 days
*Status:* ACTIVE
*Payment:* ₹ 1,500
*Payment Status:* PAID

Thank you for your payment! 💪
— *Maruthi Gym*
```

The `*bold*` markers and emoji are WhatsApp's own formatting, so it renders like
the card on the site rather than as a wall of plain text. Every field the image
shows is repeated here, so the message survives a failed image download.

**When the card cannot be attached, the text is sent instead** — and
`whatsapp_style` records that it was `text`. The trigger is deliberately strict:
a Meta image header is fetched at *delivery* time, not at send time, so sending a
link to a card that fails to render would produce a delivered message containing
a broken picture that is still recorded as `sent`. `resolveReceiptStyle()`
therefore renders once before sending, and only reports `image` if the bytes
really exist. It falls back when there is no public base URL, when the payment
has no token and none can be minted, or when the rasteriser throws.

**Date and time always come from the payment row** (`date` and `createdAt`),
never from the current time — re-sending a receipt for a March payment still
says March. `Days Left` and `Status` are the one live pair, because that is a
running countdown on the website card too. `Status` is the card's two-state
`ACTIVE`/`EXPIRED`, deliberately coarser than the four-state badge on the
Students page.

**Phone numbers** are stored as 10 local digits; `toWhatsAppNumber()` prefixes
`91` exactly once, handling `9876543210`, `+91 98765 43210`, `0919876543210`
and an already-prefixed `919876543210`. A number it cannot make sense of yields
`null`, and the receipt is skipped rather than sent somewhere wrong.

---

## 6. Tests

```bash
npm test
```

121 tests across five files. The most relevant ones:

| Checklist item | Test |
| --- | --- |
| Successful payment → sent | `sends the receipt and records the message id` |
| Failed payment → nothing sent | `sends nothing when validation fails`, `sends nothing when the student does not exist` |
| Duplicate request → no duplicate receipt | `does not send twice when the same payment is triggered again`, `grants the claim to only one of two concurrent triggers` |
| Correct student's number | `sends the student's own number, never a fixed one` |
| Correct date/time, not current time | `uses the stored date, not the current date`, `reuses the stored date and time when an old payment is re-sent` |
| Correct ACTIVE/EXPIRED status | `shows EXPIRED and zero days left once the membership has lapsed`, `reports EXPIRED status for a lapsed membership` |
| Failure doesn't break the payment | `still returns 201 and saves the payment when the send throws` |
| **A real image, not a blank PNG** | `paints the navy card background`, `actually paints white glyphs`, `paints the green success accent` |
| **The card carries the real payment** | `renders materially more ink in the detail rows when the values are real`, `draws the real amount, so a bigger payment produces more ink` |
| **Card is sent as the image header** | `sends the card as the template's image header, ahead of the body` |
| **Card URL is unguessable** | `never lets the payment id appear in the card URL` |
| **Never sends a broken image** | `falls back to the text body when the card cannot be rendered` |
| **Old payments still get a card** | `mints a card token on demand for a payment recorded before the card existed` |
| **Dry-run does not lie** | `never calls Meta and does not claim the receipt was sent` |
| Label/value don't overprint | `puts every detail label on the left and its value on the right` |
| **Card endpoint is token-only** | `does not accept a payment id in place of a token`, `strips the .png suffix, because Vercel leaves it on the last path segment` |
| **Every payment gets a card URL** | `mints a card token on every new payment`, `mints a different token per payment` |
| **Client can't forge receipt state** | `ignores a card token supplied by the client` |

The card tests decode the rendered PNG and count pixels by colour, so they assert
that something was genuinely drawn — a card that renders as a flat rectangle, or
one whose text silently fails to rasterise, fails the suite.

`globalThis.fetch` is replaced with a throwing stub in every send test, so a
regression that reaches the real network fails the test rather than actually
sending a message.
