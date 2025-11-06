import { supabase } from "../supabase/supabaseClient.js";

// Create inventory item
export const createInventory = async (req, res) => {

  console.log("Incoming body:", req.body);

  try {
    const tenant_id = req.user.tenant_id;
    const { product_id, quantity = 0, cost_price = 0, selling_price = 0,expiry_date,max_stock, reorder_level = 0 } = req.body;

    if (!product_id) return res.status(400).json({ error: "product_id required" });

    const { data, error } = await supabase
      .from("inventory")
      .insert([{
        tenant_id,
        product_id,
        quantity,
        reorder_level,
        expiry_date,
        max_stock
     
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
// ✅ Get inventory with joined product details
export const getInventory = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { search, limit = 100, offset = 0 } = req.query;

    let q = supabase
      .from("inventory")
      .select(`
        id,
        quantity,
        reorder_level,
        updated_at,
        product_id,
        expiry_date,
        max_stock,
        
        products (
         
          name,
          category,
          brand,
          unit,
          cost_price,
          selling_price,
          tax_percent,
          barcode
          
          
        )
      `)
      .eq("tenant_id", tenant_id)
      .order("updated_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (search) {
      // Supabase doesn't allow direct ilike on joined fields, so you may filter client-side
      q = q.ilike("products.name", `%${search}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    // 🧩 Flatten joined data so it matches your frontend object structure
    const formatted = data.map(item => ({
  inventory_id: item.id, // rename to avoid confusion
  product_id: item.product_id, // ✅ keep original
  quantity: item.quantity,
  reorderLevel: item.reorder_level,
  updatedAt: item.updated_at,
  expiryDate: item.expiry_date,
  maxStock: item.max_stock,
  ...item.products
}));


    return res.json({ data: formatted });
  } catch (err) {
    console.error("getInventory error:", err);
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
