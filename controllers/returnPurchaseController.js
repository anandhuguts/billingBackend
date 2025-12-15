import { supabase } from "../supabase/supabaseClient.js";
import { addJournalEntry } from "../services/addJournalEntryService.js";

/* =========================================================
   ACCOUNTING HELPERS (same style as other modules)
========================================================= */


async function getCoaMap(tenant_id) {
  const { data, error } = await supabase
    .from("coa")
    .select("id, name")
    .eq("tenant_id", tenant_id);

  if (error) throw error;

  const map = {};
  data?.forEach((acc) => {
    map[acc.name.toLowerCase()] = acc.id;
  });
  return map;
}

function coaId(map, name) {
  const id = map[name.toLowerCase()];
  if (!id) throw new Error(`COA missing: ${name}`);
  return id;
}

/* =========================================================
   GET ALL PURCHASE RETURNS
========================================================= */

export const getAllPurchaseReturns = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // -----------------------------
    // Pagination & Search
    // -----------------------------
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // -----------------------------
    // STEP 1: SEARCH PURCHASES BY INVOICE NUMBER
    // -----------------------------
    let purchaseIds = [];

    if (search) {
      const { data: purchases, error: purchaseErr } = await supabase
        .from("purchases")
        .select("id")
        .eq("tenant_id", tenant_id)
        .ilike("invoice_number", `%${search}%`);

      if (purchaseErr) {
        return res.status(500).json({ error: purchaseErr.message });
      }

      purchaseIds = purchases.map(p => p.id);

      // No matching invoices → empty result
      if (purchaseIds.length === 0) {
        return res.json({
          success: true,
          page,
          limit,
          totalRecords: 0,
          totalPages: 0,
          data: []
        });
      }
    }

    // -----------------------------
    // STEP 2: FETCH PURCHASE RETURNS
    // -----------------------------
    let query = supabase
      .from("purchase_returns")
      .select(
        `
        *,
        products(name, sku),
        purchases(invoice_number),
        suppliers(name)
      `,
        { count: "exact" }
      )
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    // Apply invoice filter safely
    if (purchaseIds.length > 0) {
      query = query.in("purchase_id", purchaseIds);
    }

    const { data, error, count } = await query.range(start, end);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // -----------------------------
    // RESPONSE
    // -----------------------------
    return res.json({
      success: true,
      page,
      limit,
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      data: data || []
    });

  } catch (err) {
    console.error("getAllPurchaseReturns error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};




/* =========================================================
   GET PURCHASE RETURN BY ID
========================================================= */

export const getPurchaseReturnById = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    const { data, error } = await supabase
      .from("purchase_returns")
      .select(
        `
        *,
        products(name, sku, category),
        purchases(invoice_number),
        suppliers(name)
      `
      )
      .eq("tenant_id", tenant_id)
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

/* =========================================================
   CREATE PURCHASE RETURN
========================================================= */

export const createPurchaseReturn = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const {
      purchase_id,
      supplier_id, // optional; we will validate against purchase
      product_id,
      quantity,
      refund_method = "cash", // 'cash' | 'credit_note'
      reason = "",
      total_refund,
    } = req.body;
    console.log("🔥 createPurchaseReturn CALLED", req.body);

    if (!purchase_id || !product_id || !quantity) {
      return res.status(400).json({
        error: "purchase_id, product_id, quantity are required",
      });
    }

    const qty = Number(quantity);
    if (qty <= 0) {
      return res.status(400).json({ error: "Quantity must be > 0" });
    }

    /* ===========================
       1) Validate Purchase & Supplier
    =========================== */
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .select("id, supplier_id, tenant_id, invoice_number")
      .eq("id", purchase_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (purchaseErr) throw purchaseErr;
    if (!purchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const resolvedSupplierId = supplier_id ?? purchase.supplier_id;

    if (!resolvedSupplierId) {
      return res.status(400).json({ error: "Purchase has no supplier linked" });
    }

    if (supplier_id && supplier_id !== purchase.supplier_id) {
      return res.status(400).json({
        error: "supplier_id does not match the supplier of this purchase",
      });
    }

    /* ===========================
       2) GET PRODUCT TAX + COST (from purchase_items)
    =========================== */
    const { data: product, error: productErr } = await supabase
      .from("products")
      .select("tax, cost_price")
      .eq("tenant_id", tenant_id)
      .eq("id", product_id)
      .maybeSingle();

    if (productErr) throw productErr;
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const { data: purchaseItem, error: itemErr } = await supabase
      .from("purchase_items")
      .select("quantity, cost_price")
      .eq("tenant_id", tenant_id)
      .eq("purchase_id", purchase_id)
      .eq("product_id", product_id)
      .maybeSingle();

    if (itemErr) throw itemErr;

    if (!purchaseItem) {
      return res
        .status(400)
        .json({ error: "Product not found in this purchase" });
    }

    // Prevent returning more than purchased (basic check)
  /* =========================
   2B) Validate remaining returnable quantity
========================= */

// A) Purchased qty
const purchasedQty = Number(purchaseItem.quantity);

// B) Total returned qty so far
const { data: prevReturns, error: prevErr } = await supabase
  .from("purchase_returns")
  .select("quantity")
  .eq("tenant_id", tenant_id)
  .eq("purchase_id", purchase_id)
  .eq("product_id", product_id);

if (prevErr) throw prevErr;

const returnedQty = prevReturns?.reduce(
  (sum, r) => sum + Number(r.quantity || 0),
  0
) || 0;

// C) Remaining qty allowed
const remainingQty = purchasedQty - returnedQty;

// D) Validations
if (remainingQty <= 0) {
  return res.status(400).json({
    error: "All purchased quantity for this product has already been returned",
  });
}

if (qty > remainingQty) {
  return res.status(400).json({
    error: `Only ${remainingQty} units can be returned for this product`,
  });
}

    const unitCost = Number(purchaseItem.cost_price);
    const taxRate = Number(product.tax || 0);

    const net = qty * unitCost;
    const vat = (net * taxRate) / 100;
    const netAmount = Number(net.toFixed(2));
    const taxAmount = Number(vat.toFixed(2));
    const computedTotal = Number((netAmount + taxAmount).toFixed(2));

    const refundAmount = total_refund ? Number(total_refund) : computedTotal; // money received / liability reduced

    /* ===========================
       3) INSERT PURCHASE RETURN
    =========================== */
    const { data: inserted, error: insertErr } = await supabase
      .from("purchase_returns")
      .insert([
        {
          tenant_id,
          purchase_id,
          supplier_id: resolvedSupplierId,
          product_id,
          quantity: qty,
          refund_method,
          reason,
          total_refund: refundAmount,
        },
      ])
      .select(
        `
        *,
        products(name, sku),
        purchases(invoice_number),
        suppliers(name)
      `
      )
      .single();

    if (insertErr) throw insertErr;

    const purchase_return_id = inserted.id;

    /* ===========================
       4) UPDATE INVENTORY
    =========================== */

    const { data: existingInv, error: invErr } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("tenant_id", tenant_id)
      .eq("product_id", product_id)
      .maybeSingle();

    if (invErr) throw invErr;

    if (existingInv) {
      await supabase
        .from("inventory")
        .update({
          quantity: Number(existingInv.quantity || 0) - qty,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingInv.id);
    } else {
      // if stock not tracked before, returning still means negative stock
      await supabase.from("inventory").insert([
        {
          tenant_id,
          product_id,
          quantity: -qty,
          updated_at: new Date().toISOString(),
        },
      ]);
    }

    // Stock movement = NEGATIVE qty
    await supabase.from("stock_movements").insert([
      {
        tenant_id,
        product_id,
        movement_type: "purchase_return",
        reference_table: "purchase_returns",
        reference_id: purchase_return_id,
        quantity: -qty,
      },
    ]);

    /* ===========================
       5) ACCOUNTING
    =========================== */

   /* ===========================
   5) ACCOUNTING (Journal Only)
=========================== */

const coaMap = await getCoaMap(tenant_id);

const desc = `Purchase Return #${purchase_return_id} (Purchase #${
  purchase.invoice_number || purchase_id
})`;

// ---- Daybook ----
// Money IN (refund) → DEBIT
await supabase.from("daybook").insert([
  {
    tenant_id,
    entry_type: "purchase_return",
    description: desc,
    debit: refundAmount,
    credit: 0,
    reference_id: purchase_return_id,
  },
]);

// ------------------------------
// 5A — REFUND METHOD
// ------------------------------

// CASH refund → Supplier gives us money back
if (refund_method === "cash") {
  await addJournalEntry({
    tenant_id,
    debit_account: coaId(coaMap, "cash"),
    credit_account: coaId(coaMap, "inventory"),
    amount: netAmount,
    description: `${desc} - Inventory reversal`,
    reference_id: purchase_return_id,
    reference_type: "purchase_return",
  });

  if (taxAmount > 0) {
    await addJournalEntry({
      tenant_id,
      debit_account: coaId(coaMap, "cash"),
      credit_account: coaId(coaMap, "vat input"),
      amount: taxAmount,
      description: `${desc} - VAT reversal`,
      reference_id: purchase_return_id,
      reference_type: "purchase_return",
    });
  }
}

// CREDIT NOTE → Payables reduced
else {
  await addJournalEntry({
    tenant_id,
    debit_account: coaId(coaMap, "accounts payable"),
    credit_account: coaId(coaMap, "inventory"),
    amount: netAmount,
    description: `${desc} - Inventory reversal`,
    reference_id: purchase_return_id,
    reference_type: "purchase_return",
  });

  if (taxAmount > 0) {
    await addJournalEntry({
      tenant_id,
      debit_account: coaId(coaMap, "accounts payable"),
      credit_account: coaId(coaMap, "vat input"),
      amount: taxAmount,
      description: `${desc} - VAT reversal`,
      reference_id: purchase_return_id,
      reference_type: "purchase_return",
    });
  }
}



  
    /* ===========================
       6) VAT REVERSAL
    =========================== */

    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;

    const { data: vatRow, error: vatErr } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("period", period)
      .maybeSingle();

    if (vatErr) throw vatErr;

    const prevPurchases = Number(vatRow?.total_purchases || 0);
    const prevPurchaseVat = Number(vatRow?.purchase_vat || 0);
    const prevSalesVat = Number(vatRow?.sales_vat || 0);

    const newPurchases = prevPurchases - netAmount;
    const newPurchaseVat = prevPurchaseVat - taxAmount;
    const newVatPayable = prevSalesVat - newPurchaseVat; // VAT payable = sales_vat - purchase_vat

    if (vatRow) {
      await supabase
        .from("vat_reports")
        .update({
          total_purchases: newPurchases,
          purchase_vat: newPurchaseVat,
          vat_payable: newVatPayable,
        })
        .eq("id", vatRow.id);
    } else {
      // if no row for this period, start it with negative purchases (purchase return first)
      const initialPurchaseVat = -taxAmount;
      const initialVatPayable = 0 - initialPurchaseVat; // = +taxAmount

      await supabase.from("vat_reports").insert([
        {
          tenant_id,
          period,
          total_sales: 0,
          sales_vat: 0,
          total_purchases: -netAmount,
          purchase_vat: initialPurchaseVat,
          vat_payable: initialVatPayable,
        },
      ]);
    }

    /* ===========================
       7) RESPONSE
    =========================== */

    res.status(201).json({
      success: true,
      message: "Purchase return created successfully",
      purchase_return: inserted,
    });
  } catch (err) {
    console.error("Purchase Return Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================================================
   UPDATE PURCHASE RETURN
   (does NOT auto reverse accounting / stock)
========================================================= */

export const updatePurchaseReturn = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;
    const updates = { ...req.body };

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // prevent tenant change
    if (updates.tenant_id) delete updates.tenant_id;

    const { data, error } = await supabase
      .from("purchase_returns")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenant_id)
      .select(
        "*, products(name, sku), purchases(invoice_number), suppliers(name)"
      );

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

/* =========================================================
   DELETE PURCHASE RETURN
   (NOTE: does NOT reverse accounting/stock – use carefully)
========================================================= */

export const deletePurchaseReturn = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    const { data, error } = await supabase
      .from("purchase_returns")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenant_id)
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
