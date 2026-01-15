# 🧮 PURCHASE ACCOUNTING - COMPREHENSIVE FIX GUIDE

## 📋 WHAT WAS FIXED

### 1️⃣ **COA Type Validation Added**
- **createPurchase**: Now validates that "Accounts Payable" is `liability`, not `asset`
- **payPurchase**: Now validates account types before creating journal entries
- Both functions will **throw an error** if COA accounts have wrong types

### 2️⃣ **Improved Accounting Logic**
- Clear comments explaining double-entry mechanics
- Proper credit account selection based on payment method:
  - `credit` → Accounts Payable (liability)
  - `cash` → Cash (asset)
  - `upi/card/bank` → Bank (asset)

### 3️⃣ **Database Migration Script**
- Created `migrations/fix_coa_account_types.sql`
- Fixes any existing incorrectly classified accounts
- **YOU MUST RUN THIS ONCE** to fix account 533

---

## 🚀 STEP-BY-STEP FIX PROCEDURE

### **STEP 1: Run the Database Migration**

Execute this SQL in your Supabase SQL Editor:

```sql
-- Fix Accounts Payable (the critical one!)
UPDATE coa
SET type = 'liability'
WHERE LOWER(name) = 'accounts payable'
  AND type != 'liability';

-- Verify it worked
SELECT id, tenant_id, name, type 
FROM coa 
WHERE LOWER(name) = 'accounts payable';
```

**Expected Result:** All "Accounts Payable" accounts should show `type = 'liability'`

---

### **STEP 2: Verify COA Integrity**

Run this query to check all accounts:

```sql
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
WHERE tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'  -- Your test tenant
ORDER BY type, name;
```

**Expected Result:** All rows should show `✅ Correct`

---

### **STEP 3: Test Purchase Creation**

Create a new purchase using your API:

```json
POST /api/purchases
{
  "supplier_id": 102,
  "payment_method": "credit",
  "items": [
    {
      "product_id": 116,
      "quantity": 1,
      "cost_price": 20,
      "expiry_date": "2026-01-16"
    }
  ]
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Purchase created successfully",
  "purchase_id": 94,
  "invoice_number": "PUR-2026-0002",
  "totals": {
    "net_total": 20,
    "tax_total": 1,
    "total_amount": 21
  }
}
```

---

### **STEP 4: Verify Journal Entries**

```sql
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
LIMIT 10;
```

**Expected Result** (for purchase on credit):
```
| description              | amount | debit_account | debit_type | credit_account    | credit_type |
|--------------------------|--------|---------------|------------|-------------------|-------------|
| Purchase #PUR-... - Inventory | 20 | Inventory     | asset      | Accounts Payable | liability   |
| Purchase #PUR-... - VAT Input | 1  | VAT Input     | asset      | Accounts Payable | liability   |
```

✅ **CRITICAL:** Credit account MUST be `liability` type!

---

### **STEP 5: Verify Ledger Entries**

```sql
SELECT 
  le.id,
  coa.name as account_name,
  le.account_type,
  le.entry_type,
  le.debit,
  le.credit,
  le.balance,
  le.description
FROM ledger_entries le
JOIN coa ON le.account_id = coa.id
WHERE le.tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'
  AND le.reference_type = 'purchase'
ORDER BY le.created_at DESC
LIMIT 20;
```

**Expected Balances:**

| Account           | Type      | Debit | Credit | Balance | Notes                          |
|-------------------|-----------|-------|--------|---------|--------------------------------|
| Inventory         | asset     | 20    | 0      | +20     | ✅ Asset increases             |
| VAT Input         | asset     | 1     | 0      | +1      | ✅ Asset increases             |
| Accounts Payable  | liability | 0     | 21     | +21     | ✅ Liability increases (credit)|

**Key Point:** Accounts Payable balance should be **POSITIVE** after a credit purchase!

---

### **STEP 6: Test Purchase Payment**

Pay the purchase:

```json
POST /api/purchases/{purchase_id}/pay
{
  "amount": 21,
  "payment_method": "cash"
}
```

**Expected Journal Entry:**
```
Dr Accounts Payable (liability)  21
   Cr Cash (asset)                    21
```

---

### **STEP 7: Verify Complete Accounting Equation**

```sql
WITH balances AS (
  SELECT 
    coa.type,
    SUM(CASE WHEN le.debit > le.credit THEN le.debit - le.credit
             WHEN le.credit > le.debit THEN le.credit - le.debit
             ELSE 0 END) as net_balance
  FROM ledger_entries le
  JOIN coa ON le.account_id = coa.id
  WHERE le.tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'
  GROUP BY coa.type
)
SELECT 
  type,
  ROUND(net_balance::numeric, 2) as balance
FROM balances
ORDER BY type;
```

**Expected Result:**
```
Assets = Liabilities + Equity + Income - Expenses
```

This should **balance to zero** (or very close due to rounding).

---

## 🔍 DEBUGGING QUERIES

### Find Misclassified Accounts
```sql
SELECT id, tenant_id, name, type
FROM coa
WHERE (
  (LOWER(name) = 'accounts payable' AND type != 'liability')
  OR (LOWER(name) = 'inventory' AND type != 'asset')
  OR (LOWER(name) = 'cash' AND type != 'asset')
);
```

### Check Ledger Balance Calculation Logic
```sql
SELECT 
  coa.name,
  coa.type,
  le.debit,
  le.credit,
  le.balance,
  -- Verify balance calculation
  CASE 
    WHEN coa.type IN ('asset', 'expense') THEN
      COALESCE(LAG(le.balance) OVER w, 0) + le.debit - le.credit
    WHEN coa.type IN ('liability', 'income') THEN
      COALESCE(LAG(le.balance) OVER w, 0) - le.debit + le.credit
    ELSE NULL
  END as calculated_balance
FROM ledger_entries le
JOIN coa ON le.account_id = coa.id
WHERE le.tenant_id = '7b44ea82-1571-4cbb-866b-d783f0fa6d70'
WINDOW w AS (PARTITION BY le.account_id ORDER BY le.id)
ORDER BY coa.name, le.id;
```

---

## ✅ SUCCESS CRITERIA

Your accounting is **CORRECT** when:

1. ✅ All COA accounts have correct types
2. ✅ Purchases create proper journal entries
3. ✅ Ledger balances match expected values
4. ✅ Accounting equation balances
5. ✅ No errors when creating purchases
6. ✅ VAT reports show correct totals

---

## 🚨 COMMON ERRORS

### Error: "Accounts Payable должен быть liability но найден как asset"

**Cause:** Account 533 is still marked as `asset`

**Fix:** Run `migrations/fix_coa_account_types.sql`

---

### Error: "COA missing: Accounts Payable"

**Cause:** Account doesn't exist for this tenant

**Fix:** 
```sql
INSERT INTO coa (tenant_id, name, type)
VALUES ('your-tenant-id', 'Accounts Payable', 'liability');
```

---

## 📞 NEXT STEPS

After fixing purchase accounting, audit these modules next:

1. **Sales accounting** (invoice creation + COGS)
2. **Purchase returns** accounting
3. **Sales returns** accounting
4. **Balance sheet** report
5. **Profit & Loss** report

---

**Last Updated:** 2026-01-12  
**Status:** ✅ Production Ready
