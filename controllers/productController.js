import { supabase } from "../supabase/supabaseClient.js";

// Create product
export const createProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(400).json({ error: "Missing tenant_id" });

    const { name, category, brand, description = "", unit = "", tax = 0 } = req.body;

    if (!name) return res.status(400).json({ error: "Product name required" });

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          tenant_id,
          name,
          category,
          brand,
          description,
          unit,
          tax,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ data });
  } catch (err) {
    console.error("createProduct error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Get all products (tenant scoped)
export const getProducts = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(400).json({ error: "Missing tenant_id" });

    const { search, limit = 100, offset = 0 } = req.query;

    let q = supabase
      .from("products")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("updated_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (search) q = q.ilike("name", `%${search}%`);

    const { data, error } = await q;
    if (error) throw error;

    return res.json({ data });
  } catch (err) {
    console.error("getProducts error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Get single product by id
export const getProductById = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .match({ id: Number(id), tenant_id })
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Product not found" });

    return res.json({ data });
  } catch (err) {
    console.error("getProductById error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Update product
export const updateProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;
    const payload = req.body;

    const { data, error } = await supabase
      .from("products")
      .update(payload)
      .match({ id: Number(id), tenant_id })
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found or not yours" });

    return res.json({ data });
  } catch (err) {
    console.error("updateProduct error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;

    const { error } = await supabase
      .from("products")
      .delete()
      .match({ id: Number(id), tenant_id });

    if (error) throw error;
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("deleteProduct error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
