import { supabase } from "../supabase/supabaseClient.js";

/*
Updated columns (from your screenshot):
- id (int8, PK)
- tenant_id (uuid) — note typo in DB, keep as-is
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
    const { sales_id, invoice_id } = req.query;
    let q = supabase
      .from("sales_returns")
      .select("*")
      .order("created_at", { ascending: false });

    // Tenant isolation: if not super_admin, filter by user's tenant
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenant_id", req.user.tenant_id); // note DB column spelling
    }

    // Support either legacy sales_id or new invoice_id column
    if (invoice_id) {
      q = q.eq("invoice_id", invoice_id);
    } else if (sales_id) {
      q = q.eq("sales_id", sales_id);
    }

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
      q = q.eq("tenant_id", req.user.tenant_id);
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
       // legacy
      invoice_id, // new name
      refund_type,
      quantity,
      reason,
      product_id,
      total_refund,
    } = req.body;

    // Determine which identifier is provided
    const idValue = invoice_id || sales_id;
    const idColumn = invoice_id ? "invoice_id" : "sales_id";

    if (!idValue || !quantity || !product_id || !total_refund) {
      return res.status(400).json({
        error: `${idColumn}, quantity, product_id, and total_refund are required`,
      });
    }

    // Use authenticated user's tenant (unless super_admin provides one)
    const tenant_id =
      req.user.role === "super_admin" && req.body.tenant_id
        ? req.body.tenant_id
        : req.user.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    // Resolve return item column name
    // keep DB compatibility

    const payload = {
      tenant_id,
      [idColumn]: idValue,
      refund_type: refund_type ?? null,
      quantity,
      reason: reason ?? null,
      product_id,
      total_refund,
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
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .maybeSingle();
      if (existErr) throw existErr;

      if (!existing) {
        console.warn(
          `No inventory record found for tenant ${tenant_id}, product ${product_id}`
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

    // Normalize response key to always expose invoice_id if present else sales_id
    const record = data[0];
    if (
      record &&
      !record.invoice_id &&
      idColumn === "invoice_id"
    ) {
      // DB didn't have invoice_id column; reflect legacy field
      record.invoice_id = record.sales_id;
    }
    res.status(201).json({ sales_return: record, inventory: updatedInventory });
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
    if (updates.tenant_id && req.user.role !== "super_admin") {
      delete updates.tenant_id;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    let q = supabase.from("sales_returns").update(updates).eq("id", id);

    // Tenant isolation for non-super-admins
    if (req.user.role !== "super_admin" && req.user.tenant_id) {
      q = q.eq("tenant_id", req.user.tenant_id);
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
      q = q.eq("tenant_id", req.user.tenant_id);
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
