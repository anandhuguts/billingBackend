// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";
import { applyDiscounts } from "../controllers/BillingController.js";

// GET /api/invoices - Get all invoices with items
// GET /api/invoices?page=1&limit=10
export const getAllInvoices = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    // Pagination inputs
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    // Calculate range for Supabase
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // Fetch paginated invoices
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_items (
          *,
          products (
            name,
            brand,
            category,
            unit
          )
        )
      `, { count: "exact" })   // <-- 👈 GET TOTAL COUNT
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) throw error;

    return res.json({
      success: true,
      page,
      limit,
      total: invoices.length,
      totalRecords: invoices?.length ? invoices[0].total_count : 0,
      data: invoices
    });

  } catch (err) {
    console.error("❌ Get invoices failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};


// DELETE /api/invoices/:id - Delete invoice
export const deleteInvoice = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Check if invoice exists
    const { data: existingInvoice, error: checkError } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Delete invoice items first
    const { error: deleteItemsError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("invoice_id", id)
      .eq("tenant_id", tenant_id);

    if (deleteItemsError) throw deleteItemsError;

    // Delete invoice
    const { error: deleteInvoiceError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenant_id);

    if (deleteInvoiceError) throw deleteInvoiceError;

    return res.json({
      success: true,
      message: `✅ Invoice #${existingInvoice.invoice_number} deleted successfully!`
    });
  } catch (err) {
    console.error("❌ Invoice deletion failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

export const previewInvoice = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { items = [], customer_id = null, coupon_code = null } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    // Fetch customer if selected
    let customer = null;
    if (customer_id) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, membership_tier, loyalty_points")
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (error || !data) return res.status(404).json({ error: "Customer not found" });

      customer = data;
    }

    // Reuse discount engine (same as in createInvoice)
    let discountResult;
    try {
      discountResult = await applyDiscounts({ 
        items, 
        tenant_id, 
        customer, 
        couponCode: coupon_code 
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const {
      items: itemsWithDiscounts,
      subtotal,
      item_discount_total,
      bill_discount_total,
      coupon_discount_total,
      membership_discount_total,
      total_before_redeem,
    } = discountResult;

    // Estimate loyalty points (preview only)
    let preview_loyalty_points = 0;

    const { data: rule } = await supabase
      .from("loyalty_rules")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("is_active", true)
      .maybeSingle();

    if (rule) {
      preview_loyalty_points = Math.floor(
        (total_before_redeem / rule.currency_unit) * rule.points_per_currency
      );
    } else {
      preview_loyalty_points = Math.floor(total_before_redeem / 100);
    }

    return res.json({
      success: true,
      preview: {
        subtotal,
        total: total_before_redeem,
        item_discount_total,
        bill_discount_total,
        coupon_discount_total,
        membership_discount_total,
        preview_loyalty_points,
      },
      items: itemsWithDiscounts
    });

  } catch (err) {
    console.error("previewInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
