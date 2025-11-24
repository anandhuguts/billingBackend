import { supabase } from "../supabase/supabaseClient.js";

/*
Updated columns:
- id, created_at, Suppliers_id, refund_method, select_product, quantity, reason, tenant_id
- product_id (int4, foreign key) ← NEW
*/

export const getAllPurchaseReturns = async (req, res) => {
  try {
    const { tenant_id } = req.query;
    let q = supabase
      .from("purchase_returns")
      .select("*, products(name, sku)") // optionally join product details
      .order("created_at", { ascending: false });

    if (tenant_id) q = q.eq("tenant_id", tenant_id);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ purchase_returns: data || [] });
  } catch (err) {
    console.error("getAllPurchaseReturns error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPurchaseReturnById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("purchase_returns")
      .select("*, products(name, sku, category)")
      .eq("id", id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)
      return res.status(404).json({ error: "Purchase return not found" });
    res.json({ purchase_return: data });
  } catch (err) {
    console.error("getPurchaseReturnById error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createPurchaseReturn = async (req, res) => {
  try {
    const {
      Suppliers_id,
      refund_method,
      select_product,
      quantity,
      reason,
      tenant_id,
      product_id,
      total_refund // ← NEW required field
    } = req.body;

    // Validation
    if (!select_product || !quantity || !tenant_id || !product_id || !total_refund) {
      return res.status(400).json({
        error:
          "select_product, quantity, tenant_id, product_id, and total_refund are required",
      });
    }

    const payload = {
      Suppliers_id: Suppliers_id ?? null,
      refund_method: refund_method ?? null,
      select_product,
      quantity,
      reason: reason ?? null,
      tenant_id,
      product_id,
      total_refund // ← NEW
    };

    const { data, error } = await supabase
      .from("purchase_returns")
      .insert([payload])
      .select("*, products(name, sku)");

    if (error) return res.status(500).json({ error: error.message });

    // Inventory adjustment: decrement quantity (not below 0)
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

      // Update existing inventory by decrementing quantity (never below 0)
      const newQty = Math.max(
        (Number(existing.quantity) || 0) - (Number(quantity) || 0),
      );
      const { data: finalUpd, error: finalErr } = await supabase
        .from("inventory")
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select();
      if (finalErr) throw finalErr;
      updatedInventory = finalUpd[0];
    } catch (invErr) {
      console.error("Inventory decrement failed (purchase return)", invErr);
    }

    res
      .status(201)
      .json({ purchase_return: data[0], inventory: updatedInventory });
  } catch (err) {
    console.error("createPurchaseReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePurchaseReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // product_id can be updated if needed
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabase
      .from("purchase_returns")
      .update(updates)
      .eq("id", id)
      .select("*, products(name, sku)");

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Purchase return not found" });
    }
    res.json({ purchase_return: data[0] });
  } catch (err) {
    console.error("updatePurchaseReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deletePurchaseReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("purchase_returns")
      .delete()
      .eq("id", id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Purchase return not found" });
    }
    res.json({ message: "Deleted", purchase_return: data[0] });
  } catch (err) {
    console.error("deletePurchaseReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
