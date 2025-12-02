import { supabase } from "../supabase/supabaseClient.js";
import { getNextPurchaseSequence } from "../utils/getNextPurchaseSequence.js";
// ===========================
// ACCOUNTING HELPERS
// ===========================

/**
 * JOURNAL entry (double-entry)
 * debit_account, credit_account are COA IDs
 */
export async function addJournalEntry({
  tenant_id,
  debit_account,
  credit_account,
  amount,
  description,
  reference_id = null,
  reference_type = "purchase",
}) {
  const { error } = await supabase.from("journal_entries").insert([
    {
      tenant_id,
      debit_account,
      credit_account,
      amount,
      description,
      reference_id,
      reference_type,
    },
  ]);

  if (error) throw error;
}

/**
 * LEDGER entry with running balance by (tenant_id, account_type)
 * account_type is a string, like: 'inventory', 'vat_input', 'cash', 'accounts_payable'
 */
export async function insertLedgerEntry({
  tenant_id,
  account_type,
  account_id = null, // should be COA id if used, else null
  entry_type,
  description,
  debit = 0,
  credit = 0,
  reference_id = null,
}) {
  const { data: lastRows, error: lastErr } = await supabase
    .from("ledger_entries")
    .select("id, balance")
    .eq("tenant_id", tenant_id)
    .eq("account_type", account_type)
    .order("created_at", { ascending: false })
    .limit(1);

  let prevBalance = 0;
  if (!lastErr && lastRows && lastRows.length > 0) {
    prevBalance = Number(lastRows[0].balance || 0);
  }

  const newBalance =
    Number(prevBalance) + Number(debit || 0) - Number(credit || 0);

  const { error: insertErr } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_type,
      account_id,
      entry_type,
      description,
      debit,
      credit,
      balance: newBalance,
      reference_id,
    },
  ]);

  if (insertErr) throw insertErr;
}

// Small helper for COA mapping (same pattern as purchase_return)
async function getCoaMap(tenant_id) {
  const { data, error } = await supabase
    .from("coa")
    .select("id, name")
    .eq("tenant_id", tenant_id);

  if (error) throw error;

  const map = {};
  data.forEach((acc) => {
    map[acc.name.toLowerCase()] = acc.id;
  });
  return map;
}

function coaId(map, name) {
  const id = map[name.toLowerCase()];
  if (!id) throw new Error(`COA missing: ${name}`);
  return id;
}

// ===========================
// CONTROLLERS
// ===========================

// GET /api/purchases - Get all purchases with items
export const getAllPurchases = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    // Pagination query params
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // Fetch purchases with count
    const { data: purchases, error, count } = await supabase
      .from("purchases")
      .select(
        `
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
      `,
        { count: "exact" }
      )
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) throw error;

    // Format purchases response
    const formattedPurchases =
      purchases?.map((purchase) => ({
        id: purchase.id,
        invoice_number: purchase.invoice_number,
        supplier_id: purchase.supplier_id,
        total_amount: purchase.total_amount,
        created_at: purchase.created_at,
        updated_at: purchase.updated_at,
        items: (purchase.purchase_items || []).map((item) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.products?.name,
          product_brand: item.products?.brand,
          product_category: item.products?.category,
          product_unit: item.products?.unit,
          quantity: item.quantity,
          cost_price: item.cost_price,
          created_at: item.created_at,
        })),
        items_count: purchase.purchase_items?.length || 0,
      })) || [];

    return res.json({
      success: true,
      page,
      limit,
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      data: formattedPurchases,
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
      .select(
        `
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
      `
      )
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    const formattedPurchase = {
      id: purchase.id,
      invoice_number: purchase.invoice_number,
      supplier_id: purchase.supplier_id,
      total_amount: purchase.total_amount,
      created_at: purchase.created_at,
      updated_at: purchase.updated_at,
      items: (purchase.purchase_items || []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.products?.name,
        product_brand: item.products?.brand,
        product_category: item.products?.category,
        product_unit: item.products?.unit,
        quantity: item.quantity,
        cost_price: item.cost_price,
        created_at: item.created_at,
      })),
    };

    return res.json({
      success: true,
      data: formattedPurchase,
    });
  } catch (err) {
    console.error("❌ Get purchase failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// POST /api/purchases - Create new purchase WITH accounting
export const createPurchase = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });
    console.log(req.body);
    const {
      supplier_id,
      items,
      payment_method = "cash", // 'cash' or 'credit'
      invoice_number: clientInvoiceNumber,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No purchase items provided" });
    }

    if (!supplier_id) {
      return res.status(400).json({ error: "supplier_id is required" });
    }

    // 1️⃣ Fetch product tax
    const productIds = [...new Set(items.map((i) => i.product_id))];

    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, tax")
      .eq("tenant_id", tenant_id)
      .in("id", productIds);

    if (prodErr) throw prodErr;
    if (!products || products.length === 0) {
      return res
        .status(400)
        .json({ error: "Products not found for this tenant" });
    }

    const taxMap = {};
    for (const p of products) {
      taxMap[p.id] = Number(p.tax || 0);
    }

    // 2️⃣ Compute totals
    let netTotal = 0;
    let taxTotal = 0;

    const normalizedItems = items.map((item) => {
      const qty = Number(item.quantity || 0);
      const cost = Number(item.cost_price || 0);
      const lineNet = qty * cost;

      const taxRate = taxMap[item.product_id] || 0;
      const lineTax = (lineNet * taxRate) / 100;

      netTotal += lineNet;
      taxTotal += lineTax;

      return {
        ...item,
        quantity: qty,
        cost_price: cost,
        _lineNet: lineNet,
        _lineTax: lineTax,
      };
    });

    netTotal = Number(netTotal.toFixed(2));
    taxTotal = Number(taxTotal.toFixed(2));
    const total_amount = Number((netTotal + taxTotal).toFixed(2));

    // 3️⃣ Auto-generate invoice number

    const seq = await getNextPurchaseSequence(tenant_id);
    const year = new Date().getFullYear();
    const invoice_number = `PUR-${year}-${String(seq).padStart(4, "0")}`;
    // 4️⃣ Insert purchase

    // 4️⃣ Insert purchase WITHOUT invoice_number first
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .insert([
        {
          tenant_id,
          supplier_id,
          total_amount,
        },
      ])
      .select("id, created_at")
      .single();

    if (purchaseErr) throw purchaseErr;

    const purchase_id = purchase.id;

    // 4.1️⃣ Now update invoice_number using sequence
 const { error: invErr } = await supabase
  .from("purchases")
  .update({ invoice_number })
  .eq("id", purchase_id)
  .eq("tenant_id", tenant_id)
  .select("*")
  .single();

if (invErr) throw invErr;


    // 5️⃣ Insert purchase_items
    const purchaseItemsData = normalizedItems.map((item) => ({
      tenant_id,
      purchase_id,
      product_id: item.product_id,
      quantity: item.quantity,
      cost_price: item.cost_price,
      // total column in DB = quantity * cost_price
    }));

    const { error: itemsErr } = await supabase
      .from("purchase_items")
      .insert(purchaseItemsData);

    if (itemsErr) throw itemsErr;

    // 6️⃣ Update inventory + stock movements
    for (const item of normalizedItems) {
      const { product_id, quantity, expiry_date, reorder_level, max_stock } =
        item;

      const { data: existing } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, expiry_date, max_stock")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .maybeSingle();

      if (existing) {
        const newQty = Number(existing.quantity || 0) + Number(quantity);

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

      await supabase.from("stock_movements").insert([
        {
          tenant_id,
          product_id,
          movement_type: "purchase",
          reference_table: "purchases",
          reference_id: purchase_id,
          quantity,
        },
      ]);
    }

    // 7️⃣ ACCOUNTING
    try {
      const coaMap = await getCoaMap(tenant_id);
      const desc = `Purchase #${invoice_number}`;
      const isCreditPurchase = payment_method === "credit";

      // Daybook
      await supabase.from("daybook").insert([
        {
          tenant_id,
          entry_type: "purchase",
          description: desc,
          debit: total_amount,
          credit: 0,
          reference_id: purchase_id,
        },
      ]);

      // Ledger - Inventory (debit)
      await insertLedgerEntry({
        tenant_id,
        account_type: "inventory",
        entry_type: "debit",
        description: desc,
        debit: netTotal,
        credit: 0,
        reference_id: purchase_id,
        account_id: null,
      });

      // Ledger - VAT Input (debit)
      if (taxTotal > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "vat_input",
          entry_type: "debit",
          description: `${desc} VAT`,
          debit: taxTotal,
          credit: 0,
          reference_id: purchase_id,
          account_id: null,
        });
      }

      // Ledger - Cash or Accounts Payable (credit)
      await insertLedgerEntry({
        tenant_id,
        account_type: isCreditPurchase ? "accounts_payable" : "cash",
        account_id: null, // DO NOT use supplier_id here, account_id is COA FK
        entry_type: "credit",
        description: desc,
        debit: 0,
        credit: total_amount,
        reference_id: purchase_id,
      });

      // Journal - Inventory (Debit) vs Cash/AP (Credit)
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "inventory"),
        credit_account: isCreditPurchase
          ? coaId(coaMap, "accounts payable")
          : coaId(coaMap, "cash"),
        amount: netTotal,
        description: `${desc} - Inventory`,
        reference_id: purchase_id,
        reference_type: "purchase",
      });

      // Journal - VAT Input vs Cash/AP
      if (taxTotal > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "vat input"),
          credit_account: isCreditPurchase
            ? coaId(coaMap, "accounts payable")
            : coaId(coaMap, "cash"),
          amount: taxTotal,
          description: `${desc} - VAT`,
          reference_id: purchase_id,
          reference_type: "purchase",
        });
      }

      // VAT REPORT
      const purchaseDate = new Date(purchase.created_at);
      const period = `${purchaseDate.getFullYear()}-${String(
        purchaseDate.getMonth() + 1
      ).padStart(2, "0")}`;

      const { data: vatRow } = await supabase
        .from("vat_reports")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("period", period)
        .maybeSingle();

      if (vatRow) {
        const newPurchases =
          Number(vatRow.total_purchases || 0) + Number(netTotal);
        const newPurchaseVat =
          Number(vatRow.purchase_vat || 0) + Number(taxTotal);
        const vatPayable =
          Number(vatRow.sales_vat || 0) - Number(newPurchaseVat);

        await supabase
          .from("vat_reports")
          .update({
            total_purchases: newPurchases,
            purchase_vat: newPurchaseVat,
            vat_payable: vatPayable,
          })
          .eq("id", vatRow.id);
      } else {
        await supabase.from("vat_reports").insert([
          {
            tenant_id,
            period,
            total_sales: 0,
            sales_vat: 0,
            total_purchases: netTotal,
            purchase_vat: taxTotal,
            vat_payable: -taxTotal, // no sales yet, so only input VAT
          },
        ]);
      }
    } catch (accErr) {
      console.error("⚠ Accounting error:", accErr);
      // You might choose to return 500 here if you want accounting to be strict
    }
if (payment_method === "cash") {

  // Record payment entry
  await supabase.from("purchase_payments").insert([
    {
      tenant_id,
      purchase_id,
      supplier_id,
      amount: total_amount,
      payment_method: "cash"
    } 
  ]);

  // Mark purchase as paid
  await supabase
    .from("purchases")
    .update({
      amount_paid: total_amount,
      is_paid: true
    })
    .eq("id", purchase_id)
     .eq("tenant_id", tenant_id);
}


    // 8️⃣ Final response
    return res.status(201).json({
      success: true,
      message: "Purchase created successfully",
      purchase_id,
      invoice_number,
      totals: {
        net_total: netTotal,
        tax_total: taxTotal,
        total_amount,
      },
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

    const { data: existingPurchase, error: checkError } = await supabase
      .from("purchases")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const { data: purchase, error } = await supabase
      .from("purchases")
      .update({
        supplier_id,
        invoice_number,
        updated_at: new Date(),
      })
      .eq("id", id)
      .eq("tenant_id", tenant_id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: "✅ Purchase updated successfully!",
      data: purchase,
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

    const { data: existingPurchase, error: checkError } = await supabase
      .from("purchases")
      .select("id, invoice_number")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    // ⚠️ NOTE: This currently does NOT reverse inventory or accounting.
    // For testing it's okay; for production you might want a "purchase_cancel" flow instead.

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
      message: `✅ Purchase #${existingPurchase.invoice_number} deleted successfully!`,
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

    const firstDayOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    ).toISOString();

    const { data: purchases, error } = await supabase
      .from("purchases")
      .select("total_amount, created_at")
      .eq("tenant_id", tenant_id)
      .gte("created_at", firstDayOfMonth)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const totalThisMonth = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.total_amount || 0),
      0
    );
    const purchaseCount = purchases.length;

    return res.json({
      success: true,
      data: {
        total_this_month: totalThisMonth,
        purchase_count: purchaseCount,
        recent_purchases: purchases.slice(0, 5),
      },
    });
  } catch (err) {
    console.error("❌ Get purchase stats failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// POST /api/purchases/:id/pay - Record payment for a purchase
export const payPurchase = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { amount, payment_method = "cash" } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    // 1️⃣ Fetch purchase
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .select("id, total_amount, supplier_id")
      .eq("id", id)
      .eq("tenant_id", tenant_id)
      .single();

    if (purchaseErr || !purchase)
      return res.status(404).json({ error: "Purchase not found" });

    const supplier_id = purchase.supplier_id;

    // 2️⃣ Insert payment record
    const { error: payErr } = await supabase.from("purchase_payments").insert([
      {
        tenant_id,
        purchase_id: id,
        supplier_id,
        amount,
        payment_method,
      },
    ]);

    if (payErr) throw payErr;

    // 3️⃣ COA mapping
    const coaMap = await getCoaMap(tenant_id);
    const desc = `Payment for Purchase #${id}`;

    // 4️⃣ Journal entry: Debit AP, Credit Cash
    await addJournalEntry({
      tenant_id,
      debit_account: coaId(coaMap, "accounts payable"),
      credit_account: coaId(coaMap, "cash"),
      amount,
      description: desc,
      reference_id: id,
      reference_type: "purchase_payment",
    });

    // 5️⃣ Ledger: Debit Accounts Payable
    await insertLedgerEntry({
      tenant_id,
      account_type: "accounts_payable",
      account_id: null, // don't use supplier_id here; account_id is COA FK
      entry_type: "debit",
      description: desc,
      debit: amount,
      credit: 0,
      reference_id: id,
    });

    // 6️⃣ Ledger: Credit Cash
    await insertLedgerEntry({
      tenant_id,
      account_type: "cash",
      account_id: null,
      entry_type: "credit",
      description: desc,
      debit: 0,
      credit: amount,
      reference_id: id,
    });

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      purchase_id: id,
      paid_amount: amount,
    });
  } catch (err) {
    console.error("❌ Payment failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

export const getPurchasePayments = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const purchase_id = req.params.id;

    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .select("id, total_amount")
      .eq("tenant_id", tenant_id)
      .eq("id", purchase_id)
      .single();

    if (purchaseErr || !purchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const { data: payments, error: payErr } = await supabase
      .from("purchase_payments")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("purchase_id", purchase_id)
      .order("created_at", { ascending: true });

    if (payErr) throw payErr;

    const total_paid = payments.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0
    );
    const remaining_due = Number(purchase.total_amount || 0) - total_paid;

    return res.json({
      success: true,
      purchase_id,
      total_amount: purchase.total_amount,
      total_paid,
      remaining_due,
      payments,
    });
  } catch (err) {
    console.error("❌ Get purchase payments failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};
