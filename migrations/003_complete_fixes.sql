-- ============================================================
-- COMPLETE FIX: All Billing & Purchase Controller Issues
-- ============================================================
-- Run this SQL in Supabase SQL Editor to fix all race conditions
-- This combines fixes for both billing and purchase controllers
-- ============================================================

-- ============================================================
-- PART 1: CONSTRAINTS (Run these first)
-- ============================================================

-- 1. Add unique constraint on invoice numbers per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_tenant_invoice_number_key'
  ) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_invoice_number_key UNIQUE (tenant_id, invoice_number);
  END IF;
END $$;

-- 2. Add unique constraint on VAT reports period per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vat_reports_tenant_period_key'
  ) THEN
    ALTER TABLE vat_reports ADD CONSTRAINT vat_reports_tenant_period_key UNIQUE (tenant_id, period);
  END IF;
END $$;

-- ============================================================
-- PART 2: SALES/BILLING RPC FUNCTIONS
-- ============================================================

-- 3. Atomic sales invoice sequence generator
CREATE OR REPLACE FUNCTION get_next_sales_seq(p_tenant_id uuid)
RETURNS integer AS $$
DECLARE
  next_seq integer;
BEGIN
  INSERT INTO tenant_counters (tenant_id, sales_seq)
  VALUES (p_tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
  SET sales_seq = tenant_counters.sales_seq + 1
  RETURNING sales_seq INTO next_seq;
  
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- 4. Atomic inventory decrement with stock check (for sales)
CREATE OR REPLACE FUNCTION decrement_inventory(
  p_tenant_id uuid,
  p_product_id integer,
  p_quantity numeric
)
RETURNS TABLE(success boolean, new_quantity numeric) AS $$
DECLARE
  current_qty numeric;
  new_qty numeric;
BEGIN
  -- Lock the row for update
  SELECT quantity INTO current_qty
  FROM inventory
  WHERE tenant_id = p_tenant_id AND product_id = p_product_id
  FOR UPDATE;
  
  -- Check if enough stock
  IF current_qty IS NULL OR current_qty < p_quantity THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;
  
  -- Decrement stock
  UPDATE inventory
  SET quantity = quantity - p_quantity
  WHERE tenant_id = p_tenant_id AND product_id = p_product_id
  RETURNING quantity INTO new_qty;
  
  RETURN QUERY SELECT true, new_qty;
END;
$$ LANGUAGE plpgsql;

-- 5. Atomic VAT report update for sales
CREATE OR REPLACE FUNCTION increment_vat_report(
  p_tenant_id uuid,
  p_period varchar,
  p_sales numeric,
  p_vat numeric
)
RETURNS void AS $$
BEGIN
  INSERT INTO vat_reports (tenant_id, period, total_sales, sales_vat, total_purchases, purchase_vat, vat_payable)
  VALUES (p_tenant_id, p_period, p_sales, p_vat, 0, 0, p_vat)
  ON CONFLICT (tenant_id, period) DO UPDATE
  SET 
    total_sales = vat_reports.total_sales + EXCLUDED.total_sales,
    sales_vat = vat_reports.sales_vat + EXCLUDED.sales_vat,
    vat_payable = (vat_reports.sales_vat + EXCLUDED.sales_vat) - vat_reports.purchase_vat;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 3: PURCHASE RPC FUNCTIONS
-- ============================================================

-- 6. Atomic purchase sequence generator
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

-- 7. Atomic VAT report update for purchases
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

-- ============================================================
-- PART 4: UTILITY FUNCTIONS
-- ============================================================

-- 8. Cleanup orphaned employee discount records (run periodically)
CREATE OR REPLACE FUNCTION cleanup_orphaned_employee_discounts()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM employee_discount_usage
  WHERE invoice_id IS NULL
    AND used_at < NOW() - INTERVAL '1 hour';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION: Check if all functions were created
-- ============================================================
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_next_sales_seq',
    'decrement_inventory',
    'increment_vat_report',
    'get_next_purchase_seq',
    'increment_vat_report_purchase',
    'cleanup_orphaned_employee_discounts'
  )
ORDER BY routine_name;

-- Expected result: 6 rows (all functions created successfully)

-- ============================================================
-- DONE! 
-- ============================================================
-- Next steps:
-- 1. Restart your backend server
-- 2. Test invoice creation
-- 3. Test purchase creation
-- 4. Verify no duplicate invoice/purchase numbers
-- ============================================================
