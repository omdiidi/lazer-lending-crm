-- Add mortgage/property lead fields that arrive with skip-traced homeowner lists
-- (PropStream / ZeroBounce exports). Typed columns so leads can be filtered/sorted
-- by home value, LTV, credit grade, loan type, etc. inside the CRM.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS address              text,
  ADD COLUMN IF NOT EXISTS city                 text,
  ADD COLUMN IF NOT EXISTS state                text,
  ADD COLUMN IF NOT EXISTS zip                  text,
  ADD COLUMN IF NOT EXISTS estimated_home_value numeric,
  ADD COLUMN IF NOT EXISTS mortgage_balance     numeric,
  ADD COLUMN IF NOT EXISTS ltv                  numeric,
  ADD COLUMN IF NOT EXISTS credit_grade         text,
  ADD COLUMN IF NOT EXISTS property_type        text,
  ADD COLUMN IF NOT EXISTS loan_type            text,
  ADD COLUMN IF NOT EXISTS interest_rate        numeric,
  ADD COLUMN IF NOT EXISTS cash_out             text,
  ADD COLUMN IF NOT EXISTS va_status            text,
  ADD COLUMN IF NOT EXISTS va_loan              text,
  ADD COLUMN IF NOT EXISTS fha_loan             text,
  ADD COLUMN IF NOT EXISTS product              text,
  ADD COLUMN IF NOT EXISTS ip_address           text,
  ADD COLUMN IF NOT EXISTS source_timestamp     text,
  ADD COLUMN IF NOT EXISTS external_lead_id     text;

-- Helpful indexes for the filters a mortgage broker will actually use.
CREATE INDEX IF NOT EXISTS idx_leads_state         ON public.leads (state);
CREATE INDEX IF NOT EXISTS idx_leads_credit_grade  ON public.leads (credit_grade);
CREATE INDEX IF NOT EXISTS idx_leads_loan_type     ON public.leads (loan_type);
