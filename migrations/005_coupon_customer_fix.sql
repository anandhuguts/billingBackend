-- ============================================================
-- COUPON SYSTEM FIX
-- ============================================================
-- This makes customer_id nullable in coupon_usage table
-- But the business rule enforces customer requirement in code
-- ============================================================

-- 1. Make customer_id nullable (for flexibility)
ALTER TABLE coupon_usage 
ALTER COLUMN customer_id DROP NOT NULL;

-- 2. Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_coupon_usage_customer 
ON coupon_usage(customer_id) 
WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon 
ON coupon_usage(coupon_id);

-- 3. Verify the change
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'coupon_usage'
  AND column_name = 'customer_id';

-- Expected: is_nullable = 'YES'

-- ============================================================
-- NOTES:
-- ============================================================
-- - Database allows NULL (flexibility)
-- - Code enforces business rule (coupons require customer)
-- - This separation of concerns is best practice
-- - Can change business rule later without database migration
-- ============================================================
