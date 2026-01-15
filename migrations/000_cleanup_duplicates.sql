-- ============================================================
-- STEP 1: Clean Up Duplicate Invoice Numbers
-- ============================================================
-- Run this FIRST to fix existing duplicates
-- Then run 003_complete_fixes.sql
-- ============================================================

-- Find and display duplicate invoice numbers
SELECT 
  tenant_id,
  invoice_number,
  COUNT(*) as duplicate_count,
  STRING_AGG(id::text, ', ') as invoice_ids
FROM invoices
WHERE invoice_number IS NOT NULL
GROUP BY tenant_id, invoice_number
HAVING COUNT(*) > 1
ORDER BY tenant_id, invoice_number;

-- ============================================================
-- Fix duplicates by renumbering them
-- ============================================================

DO $$
DECLARE
  duplicate_record RECORD;
  new_invoice_number TEXT;
  counter INT;
BEGIN
  -- Loop through each duplicate invoice number
  FOR duplicate_record IN
    SELECT 
      tenant_id,
      invoice_number,
      ARRAY_AGG(id ORDER BY created_at) as invoice_ids
    FROM invoices
    WHERE invoice_number IS NOT NULL
    GROUP BY tenant_id, invoice_number
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the first invoice, renumber the rest
    counter := 1;
    
    -- Skip the first invoice (invoice_ids[1]), renumber others
    FOR i IN 2..array_length(duplicate_record.invoice_ids, 1) LOOP
      -- Generate new unique invoice number
      new_invoice_number := duplicate_record.invoice_number || '-DUP-' || counter;
      
      -- Update the duplicate
      UPDATE invoices
      SET invoice_number = new_invoice_number
      WHERE id = duplicate_record.invoice_ids[i];
      
      RAISE NOTICE 'Renamed invoice ID % from % to %', 
        duplicate_record.invoice_ids[i], 
        duplicate_record.invoice_number, 
        new_invoice_number;
      
      counter := counter + 1;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Duplicate cleanup complete!';
END $$;

-- ============================================================
-- Verify no duplicates remain
-- ============================================================

SELECT 
  tenant_id,
  invoice_number,
  COUNT(*) as count
FROM invoices
WHERE invoice_number IS NOT NULL
GROUP BY tenant_id, invoice_number
HAVING COUNT(*) > 1;

-- Should return 0 rows if successful

-- ============================================================
-- Now you can safely run 003_complete_fixes.sql
-- ============================================================
