import { supabase } from "../supabase/supabaseClient.js";

// Create inventory item
export const createInventory = async (req, res) => {
  console.log("Incoming body:", req.body);

  try {
    const tenant_id = req.user.tenant_id;
    const {
      product_id,
      quantity = 0,
      expiry_date,
      max_stock,
      reorder_level = 0,
    } = req.body;

    if (!product_id)
      return res.status(400).json({ error: "product_id required" });

    const { data, error } = await supabase
      .from("inventory")
      .insert([
        {
          tenant_id,
          product_id,
          quantity,
          reorder_level,
          expiry_date,
          max_stock,
          // Remove cost_price and selling_price from here
        },
      ])
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

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = req.query.search?.trim();

    const start = (page - 1) * limit;
    const end = start + limit;

    // ======================================================
    // 🔍 SEARCH MODE → USE RPC
    // ======================================================
    if (search) {
      const { data, error } = await supabase.rpc("search_inventory", {
        p_tenant: tenant_id,
        p_search: search
      });

      if (error) throw error;

      const totalRecords = data.length;
      const paginated = data.slice(start, end);

      return res.json({
        success: true,
        page,
        limit,
        search,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data: paginated
      });
    }

    // ======================================================
    // 📦 NORMAL MODE → NO SEARCH
    // ======================================================
    const { data, count, error } = await supabase
  .from("inventory")
  .select(
    `
    id,
    quantity,
    reorder_level,
    updated_at,
    product_id,
    expiry_date,
    max_stock,
    products (
      id,
      name,
      brand,
      unit,
      cost_price,
      selling_price,
      tax,
      barcode,
      sku,
      categories:categories!products_category_id_fkey (
        id,
        name
      )
    )
    `,
    { count: "exact" }
  )
  .eq("tenant_id", tenant_id)
  .order("updated_at", { ascending: false })
  .range(start, end - 1);

    if (error) throw error;

    const formatted = data.map(item => ({
      id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      reorderLevel: item.reorder_level,
      updatedAt: item.updated_at,
      expiryDate: item.expiry_date,
      maxStock: item.max_stock,
      ...item.products,
      category: item.products?.categories
    }));

    return res.json({
      success: true,
      page,
      limit,
      search: "",
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      data: formatted
    });

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
    const { cost_price, selling_price, ...validPayload } = req.body; // Remove invalid fields

    // Ensure update is applied only for this tenant's record
    const { data, error } = await supabase
      .from("inventory")
      .update(validPayload) // Only use valid fields
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
