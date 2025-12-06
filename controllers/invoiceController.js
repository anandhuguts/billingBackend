// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";
import { applyDiscounts } from "../services/applyDiscountsService.js";
import { calculateEmployeeDiscount } from "../services/calculateEmployeeDiscountServices.js";

// GET /api/invoices - Get all invoices with items
// GET /api/invoices?page=1&limit=10
export const getAllInvoices = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    let query = supabase
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
        ),
        customers(name)
      `, { count: "exact" })
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(start, end);

    // ============================================
    // 🔍 SEARCH SUPPORT
    // ============================================
    if (search) {
      query = supabase
        .from("invoices")
        .select(`
          *,
          invoice_items (
            *,
            products(name, brand, category, unit)
          ),
          customers(name)
        `, { count: "exact" })
        .eq("tenant_id", tenant_id)
        .or(`
          invoice_number.ilike.%${search}%,
          payment_method.ilike.%${search}%,
          customers.name.ilike.%${search}%,
          created_at.ilike.%${search}%
        `)
        .order("created_at", { ascending: false })
        .range(start, end);
    }

    const { data: invoices, error, count } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      page,
      limit,
      search,
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
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
  const { items = [], customer_id = null, coupon_code = null, employee_id = null } = req.body;


    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    // 1️⃣ FETCH price + tax from DB (IMPORTANT!)
    const productIds = items.map(i => i.product_id);

    const { data: productData, error: prodErr } = await supabase
      .from("products")
      .select("id, selling_price, tax, cost_price")
      .in("id", productIds);

    if (prodErr)
      return res.status(500).json({ error: "Failed to fetch product info" });

    const mergedItems = items.map((i) => {
      const p = productData.find(x => x.id === i.product_id);
      if (!p) throw new Error(`Product not found: ${i.product_id}`);

      return {
        product_id: i.product_id,
        qty: i.qty,
        price: Number(p.selling_price),
        tax: Number(p.tax),
        cost_price: Number(p.cost_price)
      };
    });

    // 2️⃣ FETCH CUSTOMER IF ANY
    let customer = null;
    if (customer_id) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, membership_tier, loyalty_points")
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (error || !data)
        return res.status(404).json({ error: "Customer not found" });

      customer = data;
    }

    // 3️⃣ APPLY DISCOUNTS (now we use mergedItems)
    const discountResult = await applyDiscounts({
      items: mergedItems,
      tenant_id,
      customer,
      couponCode: coupon_code
    });

    const {
      items: itemsWithDiscounts,
      subtotal,
      item_discount_total,
      bill_discount_total,
      coupon_discount_total,
      membership_discount_total,
      total_before_redeem,
    } = discountResult;

    // 4️⃣ VAT BREAKDOWN
    const vatItems = itemsWithDiscounts.map(it => ({
      product_id: it.product_id,
      tax_rate: it.tax,
      taxAmount: it.taxAmount
    }));

    const vat_total = vatItems.reduce((s, it) => s + Number(it.taxAmount), 0);

    // 5️⃣ COGS Estimate
    const cogs_estimate = mergedItems.reduce(
      (sum, it) => sum + it.qty * it.cost_price,
      0
    );

    // 6️⃣ EMPLOYEE DISCOUNT PREVIEW (always safe)
    
    const { discount: employee_discount_total } = await calculateEmployeeDiscount({
      tenant_id,
      buyer_employee_id: employee_id || null,
      subtotal: total_before_redeem
    });
    
    const employee_discount_preview = {
      eligible: employee_discount_total > 0,
      discount_this_bill: employee_discount_total
    };

    return res.json({
      success: true,
      preview: {
        subtotal,
        total: total_before_redeem,
        item_discount_total,
        bill_discount_total,
        coupon_discount_total,
        membership_discount_total,
        preview_loyalty_points: Math.floor(total_before_redeem / 100),
        vat_breakdown: {
          total_vat: vat_total,
          items: vatItems
        },
        cogs_estimate,
        employee_discount_preview
      },
      items: itemsWithDiscounts
    });

  } catch (err) {
    console.error("previewInvoice error:", err);
    return res.status(500).json({ error: err.message });
  }
};


