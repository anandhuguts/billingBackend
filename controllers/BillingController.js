import { supabase } from "../supabase/supabaseClient.js";

/**
 * @route POST /api/invoices
 * @desc Create a new invoice and update inventory
 */
export const createInvoice = async (req, res) => {
  console.log("Incoming invoice:", req.body);

  try {
    const tenant_id = req.user.tenant_id;
    const { items = [], payment_method = "cash" } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // 🧮 Step 1 — Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const tax_total = items.reduce((sum, item) => sum + ((item.price * item.tax / 100) * item.qty), 0);
    const total_amount = subtotal + tax_total;

    // 🧾 Step 2 — Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert([
        {
          tenant_id,
          total_amount,
          payment_method,
        },
      ])
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    console.log("Created invoice:", invoice);

    // 🧩 Step 3 — Insert invoice items
    const invoiceItems = items.map((item) => ({
      tenant_id,
      invoice_id: invoice.id,
      product_id: item.id,
      quantity: item.qty,
      price: item.price,
      tax: item.tax,
      total: item.total,
    }));

    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItems);

    if (itemsError) throw itemsError;

    // 📦 Step 4 — Update inventory
    const lowStockAlerts = [];

    for (const item of items) {
      const { data: invData, error: invErr } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, max_stock, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", item.id)
        .single();

   if (invErr || !invData) {
  console.warn(`⚠️ Inventory not found for product_id: ${item.id}. Creating new entry...`);

  // Create a new inventory entry for this product
  const { error: createErr } = await supabase
    .from("inventory")
    .insert([{
      tenant_id,
      product_id: item.id,
      quantity: 0, // start at zero
      reorder_level: 5, // or any default you want
      max_stock: 100, // optional
    }]);

  if (createErr) {
    console.error(`❌ Failed to create inventory record for product_id: ${item.id}`, createErr);
    continue;
  }

  // Since it was missing, there’s no stock to reduce further
  continue;
}


      const newQty = Math.max(0, (invData.quantity || 0) - item.qty);

      const { error: updateErr } = await supabase
        .from("inventory")
        .update({ quantity: newQty })
        .eq("id", invData.id)
        .eq("tenant_id", tenant_id);

      if (updateErr) {
        console.error(`Failed to update stock for product_id ${item.id}`, updateErr);
        continue;
      }

      if (newQty <= (invData.reorder_level || 0)) {
        lowStockAlerts.push({
          product_id: item.id,
          newQty,
          reorder_level: invData.reorder_level,
        });
      }
    }

    // 🧾 Step 5 — Fetch the generated invoice_number from the DB
    const { data: updatedInvoice, error: fetchError } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount, payment_method, created_at")
      .eq("id", invoice.id)
      .single();

    if (fetchError) throw fetchError;

    // ✅ Step 6 — Return response
    return res.status(201).json({
      message: "Invoice created successfully",
      invoice: updatedInvoice,
      items: invoiceItems,
      lowStockAlerts,
    });

  } catch (err) {
    console.error("❌ createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
