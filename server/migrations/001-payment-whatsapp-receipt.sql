-- WhatsApp payment receipts: per-payment delivery tracking.
--
-- Run once against the live database. Every statement is IF NOT EXISTS, so the
-- script is idempotent and safe to re-run.
--
--   psql "$DATABASE_URL" -f server/migrations/001-payment-whatsapp-receipt.sql
--
-- Equivalent to `npm run db:push` for these columns, but this script never
-- touches any other table or column, so it cannot accidentally drop or rewrite
-- existing data the way an interactive `drizzle-kit push` prompt can.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_status varchar(20) NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_message_id varchar(160);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_error text;
-- Which presentation was actually delivered: 'image' when the blue card went out
-- as the template's image header, 'text' when it fell back to the body alone.
-- Kept so a support question like "I got a photo, why?" has a real answer.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_style varchar(10);
-- Unguessable path segment for the public card URL that WhatsApp fetches.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS whatsapp_card_token varchar(64);

-- Backfill guard. The DEFAULT above already covers rows that existed before
-- this ran, but a table that was created by an older `drizzle-kit push` may have
-- the column as NULL. Those rows must be 'pending', not NULL, or the
-- duplicate-guard allowlist in claimPaymentReceipt() would reject them forever.
UPDATE payments SET whatsapp_status = 'pending' WHERE whatsapp_status IS NULL;

-- Receipt lookups and the "how many receipts failed?" question both filter on
-- this, and the table is small enough that a partial index is cheaper than the
-- sequential scan it replaces.
CREATE INDEX IF NOT EXISTS payments_whatsapp_status_idx ON payments (whatsapp_status);

-- The card endpoint resolves a payment by its token on every image request, so
-- this lookup must be an index scan. Uniqueness matters as much as the speed: two
-- payments sharing a token would mean one student is shown another's receipt.
-- Partial, because pre-migration rows have NULL and SQL treats NULLs as distinct
-- in a unique index anyway.
CREATE UNIQUE INDEX IF NOT EXISTS payments_whatsapp_card_token_idx
    ON payments (whatsapp_card_token)
    WHERE whatsapp_card_token IS NOT NULL;

-- Rows recorded before this column existed have no token, so the public card URL
-- cannot be built for them. The next delivery attempt for such a payment mints a
-- token on the fly, so a Resend in the app upgrades an old text receipt to a card
-- without touching the row by hand. The NULL marker makes the rest visible:
--   SELECT id FROM payments WHERE whatsapp_card_token IS NULL;
SELECT COUNT(*) AS payments_without_a_card_token
    FROM payments WHERE whatsapp_card_token IS NULL;
