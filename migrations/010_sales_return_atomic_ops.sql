-- ============================================================
-- SALES RETURN ATOMIC OPERATIONS
-- ============================================================
-- Additional RPC functions for sales returns
-- ============================================================

-- 1. Atomic Inventory Increment (for returns)
CREATE OR REPLACE FUNCTION increment_inventory(
  p_tenant_id uuid,
  p_product_id integer,
  p_quantity numeric,
  p_cost_value numeric
) RETURNS TABLE(
  new_quantity numeric,
  new_stock_value numeric
) AS $$
DECLARE
  v_new_qty numeric;
  v_new_value numeric;
BEGIN
  -- Atomically increase inventory (for returns)
  UPDATE inventory
  SET 
    quantity = quantity + p_quantity,
    stock_value = stock_value + p_cost_value
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
  RETURNING quantity, stock_value INTO v_new_qty, v_new_value;
  
  -- If no inventory record exists, create one
  IF NOT FOUND THEN
    INSERT INTO inventory (tenant_id, product_id, quantity, stock_value)
    VALUES (p_tenant_id, p_product_id, p_quantity, p_cost_value)
    RETURNING quantity, stock_value INTO v_new_qty, v_new_value;
  END IF;
  
  RETURN QUERY SELECT v_new_qty, v_new_value;
END;
$$ LANGUAGE plpgsql;

-- 2. Atomic Customer Stats Decrement (for returns)
CREATE OR REPLACE FUNCTION decrement_customer_stats(
  p_customer_id integer,
  p_tenant_id uuid,
  p_amount numeric
) RETURNS void AS $$
BEGIN
  UPDATE customers
  SET 
    total_purchases = GREATEST(0, total_purchases - 1),
    total_spent = GREATEST(0, total_spent - p_amount)
  WHERE id = p_customer_id
    AND tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Reverse Loyalty Points (for returns)
CREATE OR REPLACE FUNCTION reverse_loyalty_points(
  p_customer_id integer,
  p_tenant_id uuid,
  p_points_to_deduct integer
) RETURNS integer AS $$
DECLARE
  v_new_balance integer;
BEGIN
  UPDATE customers
  SET loyalty_points = GREATEST(0, loyalty_points - p_points_to_deduct)
  WHERE id = p_customer_id
    AND tenant_id = p_tenant_id
  RETURNING loyalty_points INTO v_new_balance;
  
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 
  proname as function_name,
  pg_get_function_identity_arguments(oid) as arguments
FROM pg_proc
WHERE proname IN (
  'increment_inventory',
  'decrement_customer_stats',
  'reverse_loyalty_points'
)
ORDER BY proname;

-- Expected: 3 functions listed

-- ============================================================
-- SUCCESS!
-- ============================================================
-- ✅ Sales return atomic operations ready
-- ============================================================
