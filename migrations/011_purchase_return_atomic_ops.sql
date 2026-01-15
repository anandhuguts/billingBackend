-- ============================================================
-- PURCHASE RETURN ATOMIC OPERATIONS
-- ============================================================
-- RPC function for atomic purchase VAT report updates
-- ============================================================

-- 1. Atomic Purchase VAT Decrement (for purchase returns)
CREATE OR REPLACE FUNCTION decrement_purchase_vat(
  p_tenant_id uuid,
  p_period text,
  p_purchases numeric,
  p_vat numeric
) RETURNS void AS $$
BEGIN
  -- Try to update existing record
  UPDATE vat_reports
  SET 
    total_purchases = total_purchases - p_purchases,
    purchase_vat = purchase_vat - p_vat,
    vat_payable = sales_vat - (purchase_vat - p_vat)
  WHERE tenant_id = p_tenant_id
    AND period = p_period;
  
  -- If no record exists, create one
  IF NOT FOUND THEN
    INSERT INTO vat_reports (
      tenant_id, period, total_sales, sales_vat, 
      total_purchases, purchase_vat, vat_payable
    )
    VALUES (
      p_tenant_id, p_period, 0, 0,
      -p_purchases, -p_vat, p_vat
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 
  proname as function_name,
  pg_get_function_identity_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'decrement_purchase_vat'
ORDER BY proname;

-- Expected: 1 function listed

-- ============================================================
-- SUCCESS!
-- ============================================================
-- ✅ Purchase return atomic operations ready
-- ============================================================
