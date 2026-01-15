-- ============================================================
-- EMPLOYEE DISCOUNT FIX
-- ============================================================
-- Cleanup orphaned employee discount records and prevent future duplicates
-- ============================================================

-- 1. Show orphaned records (for info)
SELECT 
  COUNT(*) as orphaned_records,
  SUM(discount_amount) as total_orphaned_amount
FROM employee_discount_usage
WHERE invoice_id IS NULL;

-- 2. Delete orphaned records older than 1 hour
-- (Recent ones might be in-progress invoices)
DELETE FROM employee_discount_usage
WHERE invoice_id IS NULL
  AND used_at < NOW() - INTERVAL '1 hour';

-- 3. Verify cleanup
SELECT 
  COUNT(*) as remaining_orphaned
FROM employee_discount_usage
WHERE invoice_id IS NULL;

-- Expected: 0 or very few (only recent in-progress)

-- ============================================================
-- NOTES:
-- ============================================================
-- - Code changes prevent future duplicates
-- - This cleans up historical orphaned records
-- - Run this periodically if needed
-- ============================================================

-- 4. Optional: Create a scheduled cleanup function
CREATE OR REPLACE FUNCTION cleanup_orphaned_employee_discounts_auto()
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

-- You can call this manually or set up a cron job
-- SELECT cleanup_orphaned_employee_discounts_auto();
