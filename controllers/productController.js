import { supabase } from "../supabase/supabaseClient.js";

// ✅ CREATE PRODUCT
export const createProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(400).json({ error: "Missing tenant_id" });

    const {
      name,
      category,
      brand,
      description = "",
      unit = "",
      tax = 0,
      cost_price = 0,
      selling_price = 0,
      sku = "",
      barcode = "",
      status = "Active",
      supplier_code = "",
      hsn_code = "",
      features = "",
    } = req.body;

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
          cost_price,
          selling_price,
          sku,
          barcode,
          status,
          supplier_code,
          hsn_code,
          features,
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

// ✅ GET ALL PRODUCTS (tenant scoped, with search & pagination)
export const getProducts = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    console.log(req.user);
    if (!tenant_id) return res.status(400).json({ error: "Missing tenant_id" });

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = req.query.search?.trim() || "";

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(start, end);

    // ===============================
    // 🔍 SEARCH SUPPORT
    // ===============================
    if (search) {
      query = supabase
        .from("products")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenant_id)
        .or(`
          name.ilike.%${search}%,
          sku.ilike.%${search}%,
          barcode.ilike.%${search}%
        `)
        .order("created_at", { ascending: false })
        .range(start, end);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      page,
      limit,
      search,
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      data,
    });

  } catch (err) {
    console.error("getProducts error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};


// ✅ GET SINGLE PRODUCT BY ID
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

// ✅ UPDATE PRODUCT
export const updateProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;

    const {
      name,
      category,
      brand,
      description,
      unit,
      tax,
      cost_price,
      selling_price,
      sku,
      barcode,
      status,
      supplier_code,
      hsn_code,
      features,
    } = req.body;

    const updatePayload = {
      ...(name && { name }),
      ...(category && { category }),
      ...(brand && { brand }),
      ...(description !== undefined && { description }),
      ...(unit && { unit }),
      ...(tax !== undefined && { tax }),
      ...(cost_price !== undefined && { cost_price }),
      ...(selling_price !== undefined && { selling_price }),
      ...(sku && { sku }),
      ...(barcode && { barcode }),
      ...(status && { status }),
      ...(supplier_code && { supplier_code }),
      ...(hsn_code && { hsn_code }),
      ...(features && { features }),
    };

    const { data, error } = await supabase
      .from("products")
      .update(updatePayload)
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

// ✅ DELETE PRODUCT
export const deleteProduct = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;

    const { error } = await supabase
      .from("products")
      .delete()
      .match({ id: Number(id), tenant_id });

    if (error) throw error;
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("deleteProduct error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
