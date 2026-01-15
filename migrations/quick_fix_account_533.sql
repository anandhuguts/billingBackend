-- ============================================
-- 🔧 QUICK FIX: Purchase Accounting
-- ============================================
-- Run this script in Supabase SQL Editor to fix account 533
-- and all other incorrectly classified COA accounts

-- 1️⃣ FIX ACCOUNT 533 (Most Critical)
UPDATE coa
SET type = 'liability'
WHERE id = 533;

-- 2️⃣ FIX ALL "Accounts Payable" accounts across all tenants
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'accounts payable'
  AND type != 'liability';

-- 3️⃣ VERIFY THE FIX
SELECT 
  id,
  tenant_id,
  name,
  type,
  CASE 
    WHEN type = 'liability' THEN '✅ CORRECT'
    ELSE '❌ STILL WRONG'
  END as status
FROM coa
WHERE id = 533 OR LOWER(name) = 'accounts payable'
ORDER BY tenant_id;

-- Expected output: All rows should show '✅ CORRECT'

-- ============================================
-- 🧪 TEST: Create a Purchase & Verify
-- ============================================
-- After running the fix, test with these queries:

-- Check journal entries for your test tenant
/*
SELECT 
  je.id,
  je.description,
  je.amount,
  dr.name as debit_account,
  dr.type as debit_type,
  cr.name as credit_account,
  cr.type as credit_type
FROM journal_entries je
JOIN coa dr ON je.debit_account = dr.id
JOIN coa cr ON je.credit_account = cr.id
WHERE je.tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'
  AND je.reference_type = 'purchase'
ORDER BY je.created_at DESC
LIMIT 5;
*/

-- Check ledger balances
/*
SELECT 
  coa.name,
  coa.type,
  le.debit,
  le.credit,
  le.balance
FROM ledger_entries le
JOIN coa ON le.account_id = coa.id
WHERE le.tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'
  AND coa.id = 533
ORDER BY le.created_at DESC
LIMIT 5;
*/

-- ✅ Success Criteria:
-- - Account 533 type = 'liability'
-- - Ledger balance for AP can be negative (that's correct!)
-- - Journal entries show AP as credit account
