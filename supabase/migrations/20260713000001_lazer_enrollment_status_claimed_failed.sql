-- Allow 'claimed' and 'failed' statuses on campaign_enrollments.
--
-- The two-phase send dispatcher (claim_enrollments / claim_due_drips RPCs — see
-- 20260505000005 and 20260505000008) sets status = 'claimed' while a row is
-- reserved for a mailbox slot, and 'failed' when a send permanently errors.
-- Those two values were added directly on the live DB during ops but were never
-- captured as a migration, so the base CHECK constraint
-- (20260101000000_connect_crm_base.sql) still only permits the original six
-- statuses. A rebuild-from-migrations would therefore reject the RPCs' UPDATE
-- and silently break campaign sending. This migration reconciles the schema.
--
-- Idempotent: DROP IF EXISTS + ADD, with the full allowed set restated.

ALTER TABLE "public"."campaign_enrollments"
  DROP CONSTRAINT IF EXISTS "campaign_enrollments_status_check";

ALTER TABLE "public"."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_status_check"
  CHECK ("status" = ANY (ARRAY[
    'pending'::text,
    'claimed'::text,
    'sent'::text,
    'opened'::text,
    'replied'::text,
    'bounced'::text,
    'unsubscribed'::text,
    'failed'::text
  ]));
