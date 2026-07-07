-- Fix: leads.email_normalized was never auto-populated on INSERT.
--
-- The original lazer migration added an email_normalized column + a one-time
-- backfill + a unique index, and an auto-populate trigger — but that trigger was
-- only attached to `unsubscribes`, NOT `leads`. As a result every lead inserted
-- after the migration (e.g. CSV imports) had email_normalized = NULL, so the
-- ZeroBounce finalize step (which matches WHERE email_normalized IN (...)) updated
-- zero rows. This adds the missing trigger and backfills the affected leads.

-- 1. Trigger function: normalise email → email_normalized on insert/update.
CREATE OR REPLACE FUNCTION populate_leads_email_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    NEW.email_normalized := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Attach BEFORE INSERT OR UPDATE OF email on leads (covers app + edge functions).
DROP TRIGGER IF EXISTS trg_leads_email_normalized ON public.leads;
CREATE TRIGGER trg_leads_email_normalized
  BEFORE INSERT OR UPDATE OF email ON public.leads
  FOR EACH ROW EXECUTE FUNCTION populate_leads_email_normalized();

-- 3. Backfill existing rows whose email_normalized is NULL. Skip any value that
--    would collide with another active lead's email_normalized (the partial
--    unique index only allows one active lead per normalised email); those rare
--    duplicates stay NULL rather than failing the whole backfill.
UPDATE public.leads l
SET email_normalized = lower(trim(l.email))
WHERE l.email_normalized IS NULL
  AND l.email IS NOT NULL
  AND l.email <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.leads o
    WHERE o.id <> l.id
      AND o.deleted_at IS NULL
      AND o.email_normalized = lower(trim(l.email))
  );
