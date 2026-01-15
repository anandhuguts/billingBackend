-- ============================================================
-- EMPLOYEE DISCOUNT: Change Monthly Limit to Usage Count
-- ============================================================
-- Changes monthly_limit from "rupee amount" to "number of times"
-- ============================================================

-- 1. Show current rule
SELECT 
  id,
  discount_percent,
  max_discount_amount,
  monthly_limit as current_limit,
  'Before: This was rupee amount' as note
FROM employee_discount_rules
WHERE tenant_id = 'cd6db503-dbf7-4ced-93fc-508d9b50d7d0';

-- 2. Update to usage count
-- Change monthly_limit to a reasonable number of times
UPDATE employee_discount_rules
SET monthly_limit = 10  -- Can use discount 10 TIMES per month
WHERE tenant_id = 'cd6db503-dbf7-4ced-93fc-508d9b50d7d0';

-- 3. Verify change
SELECT 
  id,
  discount_percent,
  max_discount_amount,
  monthly_limit as new_limit,
  'After: Now this is number of times (count)' as note
FROM employee_discount_rules
WHERE tenant_id = 'cd6db503-dbf7-4ced-93fc-508d9b50d7d0';

-- ============================================================
-- USAGE EXAMPLE (After Change):
-- ============================================================
-- monthly_limit = 10 means:
-- - Employee can use discount 10 TIMES per month
-- - Each time they get 5% discount (up to max_discount_amount)
-- - NOT limited by total rupee amount anymore
--
-- Example:
-- Use 1: ₹200 bill → 5% = ₹10 discount ✅ (1/10 uses)
-- Use 2: ₹200 bill → 5% = ₹10 discount ✅ (2/10 uses)
-- ...
-- Use 10: ₹200 bill → 5% = ₹10 discount ✅ (10/10 uses)
-- Use 11: ₹200 bill → 0% = ₹0 discount ❌ (limit reached)
-- ============================================================

-- 4. Optional: Clean up this month's usage for fresh start
-- DELETE FROM employee_discount_usage
-- WHERE used_at >= DATE_TRUNC('month', NOW())
--   AND invoice_id IS NOT NULL;

-- 5. Check current monthly usage (COUNT)
SELECT 
  e.id,
  e.employee_id as emp_code,
  COUNT(edu.id) as times_used_this_month,
  10 - COUNT(edu.id) as remaining_uses
FROM employees e
LEFT JOIN employee_discount_usage edu 
  ON edu.employee_id = e.id 
  AND edu.invoice_id IS NOT NULL
  AND edu.used_at >= DATE_TRUNC('month', NOW())
WHERE e.tenant_id = 'cd6db503-dbf7-4ced-93fc-508d9b50d7d0'
GROUP BY e.id, e.employee_id;

-- ============================================================
-- DONE!
-- ============================================================
-- Restart backend (nodemon should auto-restart)
-- Test: Employee should now be able to use discount 10 times/month
-- Not limited by total amount anymore!
-- ============================================================
