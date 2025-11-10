import { supabase } from "../supabase/supabaseClient.js";

// GET /api/purchases - Get all purchases with items
export const getAllPurchases = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { data: purchases, error } = await supabase
      .from("purchases")
      .select(`
        *,
        purchase_items (
          *,
          products (
            name,
            brand,
            category,
            unit
          )
        )
      `)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Format the response to include product details in items
    const formattedPurchases = purchases.map(purchase => ({
      id: purchase.id,
      invoice_number: purchase.invoice_number,
      supplier_id: purchase.supplier_id,
      total_amount: purchase.total_amount,
      created_at: purchase.created_at,
      updated_at: purchase.updated_at,
      items: purchase.purchase_items.map(item => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.products?.name,
        product_brand: item.products?.brand,
        product_category: item.products?.category,
        product_unit: item.products?.unit,
        quantity: item.quantity,
        cost_price: item.cost_price,
        created_at: item.created_at
      })),
      items_count: purchase.purchase_items.length
    }));

    return res.json({
      success: true,
      data: formattedPurchases
    });
  } catch (err) {
    console.error("❌ Get purchases failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// GET /api/purchases/:id - Get single purchase by ID
export const getPurchaseById = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    const { data: purchase, error } = await supabase
      .from("purchases")
      .select(`
        *,
        purchase_items (
          *,
          products (
            name,
            brand,
            category,
            unit
          )
        )
      `)
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    // Format the response
    const formattedPurchase = {
      id: purchase.id,
      invoice_number: purchase.invoice_number,
      supplier_id: purchase.supplier_id,
      total_amount: purchase.total_amount,
      created_at: purchase.created_at,
      updated_at: purchase.updated_at,
      items: purchase.purchase_items.map(item => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.products?.name,
        product_brand: item.products?.brand,
        product_category: item.products?.category,
        product_unit: item.products?.unit,
        quantity: item.quantity,
        cost_price: item.cost_price,
        created_at: item.created_at
      }))
    };

    return res.json({
      success: true,
      data: formattedPurchase
    });
  } catch (err) {
    console.error("❌ Get purchase failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// POST /api/purchases - Create new purchase (your existing function)
export const createPurchase = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { supplier_id, items } = req.body;
    let invoice_number = req.body.invoice_number;

    // ✅ Auto-generate invoice if missing
    if (!invoice_number) {
      const { data: lastPurchase } = await supabase
        .from("purchases")
        .select("invoice_number")
        .eq("tenant_id", tenant_id)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      let nextNumber = 1;
      if (lastPurchase && lastPurchase.invoice_number) {
        const match = lastPurchase.invoice_number.match(/\d+$/);
        if (match) nextNumber = parseInt(match[0]) + 1;
      }

      const year = new Date().getFullYear();
      invoice_number = `INV-${year}-${String(nextNumber).padStart(4, "0")}`;
    }

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No purchase items provided" });

    // 1️⃣ Calculate total amount
    const total_amount = items.reduce(
      (sum, item) => sum + item.quantity * item.cost_price,
      0
    );

    // 2️⃣ Create new purchase
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .insert([
        { tenant_id, supplier_id, invoice_number, total_amount },
      ])
      .select("id")
      .single();

    if (purchaseErr) throw purchaseErr;
    const purchase_id = purchase.id;

    // 3️⃣ Insert purchase_items
    const purchaseItemsData = items.map((item) => ({
      tenant_id,
      purchase_id,
      product_id: item.product_id,
      quantity: item.quantity,
      cost_price: item.cost_price,
    }));

    const { error: itemsErr } = await supabase
      .from("purchase_items")
      .insert(purchaseItemsData);

    if (itemsErr) throw itemsErr;

    // 4️⃣ Update or create inventory
    for (const item of items) {
      const { product_id, quantity, expiry_date, reorder_level, max_stock } = item;

      const { data: existing } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, expiry_date, max_stock")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .maybeSingle();

      if (existing) {
        const newQty = parseFloat(existing.quantity || 0) + parseFloat(quantity);
        await supabase
          .from("inventory")
          .update({
            quantity: newQty,
            reorder_level: reorder_level ?? existing.reorder_level,
            expiry_date: expiry_date ?? existing.expiry_date,
            max_stock: max_stock ?? existing.max_stock,
            updated_at: new Date(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("inventory").insert([
          {
            tenant_id,
            product_id,
            quantity,
            reorder_level,
            expiry_date,
            max_stock,
          },
        ]);
      }
    }

    return res.status(201).json({
      success: true,
      message: "✅ Purchase created and inventory updated successfully!",
      purchase_id,
      invoice_number,
    });
  } catch (err) {
    console.error("❌ Purchase creation failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// PUT /api/purchases/:id - Update purchase
export const updatePurchase = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { supplier_id, invoice_number } = req.body;

    // Check if purchase exists and belongs to tenant
    const { data: existingPurchase, error: checkError } = await supabase
      .from("purchases")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    // Update purchase
    const { data: purchase, error } = await supabase
      .from("purchases")
      .update({
        supplier_id,
        invoice_number,
        updated_at: new Date()
      })
      .eq("id", id)
      .eq("tenant_id", tenant_id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: "✅ Purchase updated successfully!",
      data: purchase
    });
  } catch (err) {
    console.error("❌ Purchase update failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// DELETE /api/purchases/:id - Delete purchase
export const deletePurchase = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Check if purchase exists and belongs to tenant
    const { data: existingPurchase, error: checkError } = await supabase
      .from("purchases")
      .select("id, invoice_number")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    // Use transaction to delete purchase and related items
    const { error: deleteItemsError } = await supabase
      .from("purchase_items")
      .delete()
      .eq("purchase_id", id)
      .eq("tenant_id", tenant_id);

    if (deleteItemsError) throw deleteItemsError;

    const { error: deletePurchaseError } = await supabase
      .from("purchases")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenant_id);

    if (deletePurchaseError) throw deletePurchaseError;

    return res.json({
      success: true,
      message: `✅ Purchase #${existingPurchase.invoice_number} deleted successfully!`
    });
  } catch (err) {
    console.error("❌ Purchase deletion failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// GET /api/purchases/stats - Get purchase statistics
export const getPurchaseStats = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { data: purchases, error } = await supabase
      .from("purchases")
      .select("total_amount, created_at")
      .eq("tenant_id", tenant_id)
      .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()) // This month
      .order("created_at", { ascending: false });

    if (error) throw error;

    const totalThisMonth = purchases.reduce((sum, purchase) => sum + purchase.total_amount, 0);
    const purchaseCount = purchases.length;

    return res.json({
      success: true,
      data: {
        total_this_month: totalThisMonth,
        purchase_count: purchaseCount,
        recent_purchases: purchases.slice(0, 5)
      }
    });
  } catch (err) {
    console.error("❌ Get purchase stats failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};