-- ============================================================
-- EMPLOYEE DISCOUNT - DUPLICATE CLEANUP
-- ============================================================
-- Fix the duplicate records issue for employee discounts
-- ============================================================

-- 1. Show current duplicates for invoice #258
SELECT 
  id,
  employee_id,
  invoice_id,
  discount_amount,
  used_at
FROM employee_discount_usage
WHERE invoice_id = 258
ORDER BY used_at;

-- Expected: 2 rows (₹9 and ₹1)

-- 2. Delete the incorrect duplicate (₹1 record)
DELETE FROM employee_discount_usage
WHERE id = 257;

-- 3. Verify deletion
SELECT 
  SUM(discount_amount) as total_used_this_month,
  COUNT(*) as records_count
FROM employee_discount_usage
WHERE employee_id = 'a43856de-8a20-435d-bde1-d1c42986fd14'
  AND used_at >= DATE_TRUNC('month', NOW())
  AND invoice_id IS NOT NULL;

-- Expected: total_used_this_month = 9, records_count = 1

-- 4. Check if there are any other duplicates
SELECT 
  invoice_id,
  COUNT(*) as duplicate_count,
  SUM(discount_amount) as total_amount,
  array_agg(id) as record_ids
FROM employee_discount_usage
WHERE invoice_id IS NOT NULL
GROUP BY invoice_id
HAVING COUNT(*) > 1;

-- If this returns rows, you have more duplicates!

-- 5. OPTIONAL: Clean up all duplicates (keeps highest amount per invoice)
DO $$
DECLARE
  duplicate_invoice RECORD;
  keep_id integer;
BEGIN
  FOR duplicate_invoice IN
    SELECT 
      invoice_id,
      array_agg(id ORDER BY discount_amount DESC) as record_ids
    FROM employee_discount_usage
    WHERE invoice_id IS NOT NULL
    GROUP BY invoice_id
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the first one (highest discount), delete the rest
    keep_id := duplicate_invoice.record_ids[1];
    
    DELETE FROM employee_discount_usage
    WHERE invoice_id = duplicate_invoice.invoice_id
      AND id != keep_id;
      
    RAISE NOTICE 'Cleaned duplicates for invoice %, kept record %', 
      duplicate_invoice.invoice_id, keep_id;
  END LOOP;
END $$;

-- 6. Final verification
SELECT 
  employee_id,
  DATE_TRUNC('month', used_at) as month,
  COUNT(*) as total_uses,
  SUM(discount_amount) as total_discount
FROM employee_discount_usage
WHERE invoice_id IS NOT NULL
  AND used_at >= DATE_TRUNC('month', NOW())
GROUP BY employee_id, DATE_TRUNC('month', used_at);

-- ============================================================
-- DONE!
-- ============================================================
-- After running this:
-- 1. Restart backend (already done if nodemon is running)
-- 2. Test employee discount again
-- 3. Should work correctly now!
-- ============================================================
