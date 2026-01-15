-- ============================================
-- FIX COA ACCOUNT TYPES
-- ============================================
-- This script fixes incorrectly classified Chart of Accounts entries
-- Run this ONCE to fix existing data

-- 1) Fix "Accounts Payable" - MUST be liability
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'accounts payable'
  AND type != 'liability';

-- 2) Fix "VAT Payable" - MUST be liability
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'vat payable'
  AND type != 'liability';

-- 3) Fix "VAT Output" - MUST be liability
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'vat output'
  AND type != 'liability';

-- 4) Fix "Inventory" - MUST be asset
UPDATE coa
SET type = 'asset'
WHERE LOWER(name) = 'inventory'
  AND type != 'asset';

-- 5) Fix "VAT Input" - MUST be asset
UPDATE coa
SET type = 'asset'
WHERE LOWER(name) = 'vat input'
  AND type != 'asset';

-- 6) Fix "Cash" - MUST be asset
UPDATE coa
SET type = 'asset'
WHERE LOWER(name) = 'cash'
  AND type != 'asset';

-- 7) Fix "Bank" - MUST be asset
UPDATE coa
SET type = 'asset'
WHERE LOWER(name) = 'bank'
  AND type != 'asset';

-- 8) Fix "Accounts Receivable" - MUST be asset
UPDATE coa
SET type = 'asset'
WHERE LOWER(name) = 'accounts receivable'
  AND type != 'asset';

-- 9) Fix "Sales" - MUST be income
UPDATE coa
SET type = 'income'
WHERE LOWER(name) = 'sales'
  AND type != 'income';

-- 10) Fix "Cost of Goods Sold" / "COGS" - MUST be expense
UPDATE coa
SET type = 'expense'
WHERE LOWER(name) IN ('cost of goods sold', 'cogs')
  AND type != 'expense';

-- 11) Fix "Discount Expense" - MUST be expense
UPDATE coa
SET type = 'expense'
WHERE LOWER(name) = 'discount expense'
  AND type != 'expense';

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Run this to verify all accounts are correctly classified:
/*
SELECT 
  id,
  tenant_id,
  name,
  type,
  CASE 
    WHEN LOWER(name) IN ('accounts payable', 'vat payable', 'vat output') AND type != 'liability' 
      THEN '❌ Should be liability'
    WHEN LOWER(name) IN ('inventory', 'vat input', 'cash', 'bank', 'accounts receivable') AND type != 'asset'
      THEN '❌ Should be asset'
    WHEN LOWER(name) = 'sales' AND type != 'income'
      THEN '❌ Should be income'
    WHEN LOWER(name) IN ('cost of goods sold', 'cogs', 'discount expense') AND type != 'expense'
      THEN '❌ Should be expense'
    ELSE '✅ Correct'
  END as validation_status
FROM coa
ORDER BY tenant_id, type, name;
*/
