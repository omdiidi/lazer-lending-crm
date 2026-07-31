-- Add sender/subject fields to replies.
--
-- classify-reply and store-and-notify both SELECT subject, from_email, and
-- from_name from replies, but the table never had those columns — every
-- classification attempt failed with "column replies.subject does not exist"
-- (found live 2026-07-31). The Replies UI also reads them ("Unknown sender" /
-- "(no subject)" fallbacks). Populated by smartlead-events from the webhook
-- payload: subject, and the lead-side to_email/to_name of the original send.

ALTER TABLE "public"."replies" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "public"."replies" ADD COLUMN IF NOT EXISTS "from_email" text;
ALTER TABLE "public"."replies" ADD COLUMN IF NOT EXISTS "from_name" text;
