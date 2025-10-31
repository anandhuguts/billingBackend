import { supabase } from "../supabase/supabaseClient.js";

// Create inventory item
export const createInventory = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { product_id, quantity = 0, cost_price = 0, selling_price = 0, reorder_level = 0 } = req.body;

    if (!product_id) return res.status(400).json({ error: "product_id required" });

    const { data, error } = await supabase
      .from("inventory")
      .insert([{
        tenant_id,
        product_id,
        quantity,
        cost_price,
        selling_price,
        reorder_level
      }])
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Get list (tenant scoped, with optional product join)
export const getInventory = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { search, limit = 100, offset = 0 } = req.query;

    let q = supabase
      .from("inventory")
      .select(
       "*"
      )
      .eq("tenant_id", tenant_id)
      .order("updated_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1); 

    if (search) q = q.ilike("products->>name", `%${search}%`); // supabase supports filters via RPC sometimes; if not, do client-side filter

    const { data, error } = await q;
    if (error) throw error;
    return res.json({ data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Update inventory (only for items belonging to tenant)
export const updateInventory = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;
    const payload = req.body;

    // Ensure update is applied only for this tenant's record
    const { data, error } = await supabase
      .from("inventory")
      .update(payload)
      .match({ id: Number(id), tenant_id })
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found or not yours" });
    return res.json({ data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Delete inventory item
export const deleteInventory = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { id } = req.params;

    const { error } = await supabase
      .from("inventory")
      .delete()
      .match({ id: Number(id), tenant_id });

    if (error) throw error;
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
