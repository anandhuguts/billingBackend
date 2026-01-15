-- ============================================
-- 🚨 URGENT FIX: Account 533 Classification
-- ============================================
-- Run this NOW in Supabase SQL Editor

-- 1️⃣ FIX THE ISSUE
UPDATE coa
SET type = 'liability'
WHERE id = 533;

-- 2️⃣ VERIFY IT WORKED
SELECT 
  id, 
  tenant_id,
  name, 
  type,
  CASE 
    WHEN type = 'liability' THEN '✅ FIXED!'
    ELSE '❌ STILL BROKEN'
  END as status
FROM coa
WHERE id = 533;

-- Expected output:
-- id  | name             | type      | status
-- ----|------------------|-----------|------------
-- 533 | Accounts Payable | liability | ✅ FIXED!

-- 3️⃣ ALSO FIX ANY OTHER ACCOUNTS PAYABLE ENTRIES
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'accounts payable'
  AND type != 'liability';

-- 4️⃣ VERIFY ALL ACCOUNTS PAYABLE
SELECT 
  id,
  tenant_id,
  name,
  type
FROM coa
WHERE LOWER(name) = 'accounts payable'
ORDER BY tenant_id;

-- All should show type = 'liability'
