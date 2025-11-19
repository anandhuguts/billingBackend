-- Migration: create view to alias Subscription_Plans_amount_set
-- Creates view public.subscription_amount_plan as a SELECT from the existing table
CREATE OR REPLACE VIEW public.subscription_amount_plan AS
SELECT
  id,
  name,
  amount,
  amc_amount,
  billing,
  reports,
  inventory,
  "user"
FROM public."Subscription_Plans_amount_set";

-- To drop the view:
-- DROP VIEW IF EXISTS public.subscription_amount_plan;
