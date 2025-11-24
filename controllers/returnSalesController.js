import { supabase } from "../supabase/supabaseClient.js";

/*
Updated columns (from your screenshot):
- id (int8, PK)
- tenat_id (uuid) — note typo in DB, keep as-is
- created_at (timestamptz)
- sales_id (varchar)
- refund_type (text)
- return_iteam (text) — note typo in DB
- quantity (int8)
- reason (text)
- product_id (int4)
*/

// GET /api/sales_returns (filtered by tenant if user is not super_admin)
export const getAllSalesReturns = async (req, res) => {
  try {
    const { sales_id } = req.query;
    let q = supabase
      .from("sales_returns")
      .select("*")
      .order("created_at", { ascending: false });

    // Tenant isolation: if not super_admin, filter by user's tenant
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenat_id", req.user.tenant_id); // note DB column spelling
    }

    if (sales_id) q = q.eq("sales_id", sales_id);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sales_returns: data || [] });
  } catch (err) {
    console.error("getAllSalesReturns error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/sales_returns/:id
export const getSalesReturnById = async (req, res) => {
  try {
    const { id } = req.params;
    let q = supabase.from("sales_returns").select("*").eq("id", id);

    // Tenant isolation
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenat_id", req.user.tenant_id);
    }

    const { data, error } = await q.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Sales return not found" });
    res.json({ sales_return: data });
  } catch (err) {
    console.error("getSalesReturnById error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /api/sales_returns
export const createSalesReturn = async (req, res) => {
  try {
    const {
      sales_id,
      refund_type,
      return_iteam, // frontend should match DB column name
      quantity,
      reason,
      product_id,
      total_refund
    } = req.body;

    // Validation
    if (!sales_id || !quantity || !product_id || !total_refund) {
      return res
        .status(400)
        .json({ error: "sales_id, quantity, product_id, and total_refund are required" });
    }

    // Use authenticated user's tenant (unless super_admin provides one)
    const tenat_id =
      req.user.role === "super_admin" && req.body.tenat_id
        ? req.body.tenat_id
        : req.user.tenant_id;

    if (!tenat_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    const payload = {
      tenat_id, // DB column name
      sales_id,
      refund_type: refund_type ?? null,
      return_iteam: return_iteam ?? null, // DB column name
      quantity,
      reason: reason ?? null,
      product_id,
      total_refund
    };

    const { data, error } = await supabase
      .from("sales_returns")
      .insert([payload])
      .select();
    if (error) return res.status(500).json({ error: error.message });

    // Inventory adjustment: increase quantity for returned product
    let updatedInventory = null;
    try {
      // Fetch existing inventory row
      const { data: existing, error: existErr } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level")
        .eq("tenant_id", tenat_id)
        .eq("product_id", product_id)
        .maybeSingle();
      if (existErr) throw existErr;

      if (!existing) {
        console.warn(
          `No inventory record found for tenant ${tenat_id}, product ${product_id}`
        );
        return res.status(404).json({
          error:
            "Inventory record not found for this product. Please create inventory record first.",
        });
      }

      // Update existing inventory by incrementing quantity
      const newQty = (Number(existing.quantity) || 0) + (Number(quantity) || 0);
      const { data: finalUpd, error: finalErr } = await supabase
        .from("inventory")
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select();
      if (finalErr) throw finalErr;
      updatedInventory = finalUpd[0];
    } catch (invErr) {
      console.error("Inventory increment failed (sales return)", invErr);
    }

    res
      .status(201)
      .json({ sales_return: data[0], inventory: updatedInventory });
  } catch (err) {
    console.error("createSalesReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// PUT /api/sales_returns/:id
export const updateSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Prevent changing tenant unless super_admin
    if (updates.tenat_id && req.user.role !== "super_admin") {
      delete updates.tenat_id;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    let q = supabase.from("sales_returns").update(updates).eq("id", id);

    // Tenant isolation for non-super-admins
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenat_id", req.user.tenant_id);
    }

    const { data, error } = await q.select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length)
      return res
        .status(404)
        .json({ error: "Sales return not found or forbidden" });
    res.json({ sales_return: data[0] });
  } catch (err) {
    console.error("updateSalesReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /api/sales_returns/:id
export const deleteSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;
    let q = supabase.from("sales_returns").delete().eq("id", id);

    // Tenant isolation
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenat_id", req.user.tenant_id);
    }

    const { data, error } = await q.select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length)
      return res
        .status(404)
        .json({ error: "Sales return not found or forbidden" });
    res.json({ message: "Deleted", sales_return: data[0] });
  } catch (err) {
    console.error("deleteSalesReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
