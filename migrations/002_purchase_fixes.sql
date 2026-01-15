-- ============================================================
-- PURCHASE CONTROLLER FIXES - DATABASE MIGRATIONS
-- ============================================================
-- Run this in Supabase SQL Editor to fix purchase controller issues
-- ============================================================

-- 1. Atomic purchase sequence generator
CREATE OR REPLACE FUNCTION get_next_purchase_seq(p_tenant_id uuid)
RETURNS integer AS $$
DECLARE
  next_seq integer;
BEGIN
  INSERT INTO tenant_counters (tenant_id, purchase_seq)
  VALUES (p_tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
  SET purchase_seq = tenant_counters.purchase_seq + 1
  RETURNING purchase_seq INTO next_seq;
  
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- 2. Atomic VAT report update for purchases
CREATE OR REPLACE FUNCTION increment_vat_report_purchase(
  p_tenant_id uuid,
  p_period varchar,
  p_purchases numeric,
  p_vat numeric
)
RETURNS void AS $$
BEGIN
  INSERT INTO vat_reports (tenant_id, period, total_sales, sales_vat, total_purchases, purchase_vat, vat_payable)
  VALUES (p_tenant_id, p_period, 0, 0, p_purchases, p_vat, -p_vat)
  ON CONFLICT (tenant_id, period) DO UPDATE
  SET 
    total_purchases = vat_reports.total_purchases + EXCLUDED.total_purchases,
    purchase_vat = vat_reports.purchase_vat + EXCLUDED.purchase_vat,
    vat_payable = vat_reports.sales_vat - (vat_reports.purchase_vat + EXCLUDED.purchase_vat);
END;
$$ LANGUAGE plpgsql;

-- Done! Now update your purchase controller code
