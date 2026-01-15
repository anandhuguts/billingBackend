import { supabase } from "../supabase/supabaseClient.js";
import { getNextPurchaseSequence } from "../utils/getNextPurchaseSequence.js";
import { addJournalEntry } from "../services/addJournalEntryService.js";
// ===========================
// ACCOUNTING HELPERS
// ===========================

/**
 * JOURNAL entry (double-entry)
 * debit_account, credit_account are COA IDs
 */
// export async function addJournalEntry({
//   tenant_id,
//   debit_account,
//   credit_account,
//   amount,
//   description,
//   reference_id = null,
//   reference_type = "purchase",
// }) {
//   const { error } = await supabase.from("journal_entries").insert([
//     {
//       tenant_id,
//       debit_account,
//       credit_account,
//       amount,
//       description,
//       reference_id,
//       reference_type,
//     },
//   ]);

//   if (error) throw error;
// }

// /**
//  * LEDGER entry with running balance by (tenant_id, account_type)
//  * account_type is a string, like: 'inventory', 'vat_input', 'cash', 'accounts_payable'
//  */
// export async function insertLedgerEntry({
//   tenant_id,
//   account_type,
//   account_id = null, // should be COA id if used, else null
//   entry_type,
//   description,
//   debit = 0,
//   credit = 0,
//   reference_id = null,
// }) {
//   const { data: lastRows, error: lastErr } = await supabase
//     .from("ledger_entries")
//     .select("id, balance")
//     .eq("tenant_id", tenant_id)
//     .eq("account_type", account_type)
//     .order("created_at", { ascending: false })
//     .limit(1);

//   let prevBalance = 0;
//   if (!lastErr && lastRows && lastRows.length > 0) {
//     prevBalance = Number(lastRows[0].balance || 0);
//   }

//   const newBalance =
//     Number(prevBalance) + Number(debit || 0) - Number(credit || 0);

//   const { error: insertErr } = await supabase.from("ledger_entries").insert([
//     {
//       tenant_id,
//       account_type,
//       account_id,
//       entry_type,
//       description,
//       debit,
//       credit,
//       balance: newBalance,
//       reference_id,
//     },
//   ]);

//   if (insertErr) throw insertErr;
// }



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

    // -----------------------------
    // Pagination & Search
    // -----------------------------
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // -----------------------------
    // Build Query
    // -----------------------------
    let query = supabase
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
      .order("created_at", { ascending: false });

    // 🔍 SEARCH BY INVOICE NUMBER (SAFE)
    if (search) {
      query = query.ilike("invoice_number", `%${search}%`);
    }

    const { data: purchases, error, count } = await query.range(start, end);

    if (error) throw error;

    // -----------------------------
    // Format Response
    // -----------------------------
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
    if (!tenant_id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const {
      supplier_id,
      items,
      payment_method = "cash", // cash | upi | card | bank | credit
    } = req.body;
    console.log("Received purchase creation request:", req.body);

    if (!supplier_id) {
      return res.status(400).json({ error: "supplier_id is required" });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No purchase items provided" });
    }

    /* ======================================================
       1️⃣ FETCH PRODUCT TAX
    ====================================================== */
    const productIds = [...new Set(items.map(i => i.product_id))];

    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, tax")
      .eq("tenant_id", tenant_id)
      .in("id", productIds);

    if (prodErr) throw prodErr;
    if (!products || products.length === 0) {
      return res.status(400).json({ error: "Products not found" });
    }

    const taxMap = {};
    products.forEach(p => {
      taxMap[p.id] = Number(p.tax || 0);
    });

    /* ======================================================
       2️⃣ CALCULATE TOTALS (NET + VAT)
    ====================================================== */
    let netTotal = 0;
    let taxTotal = 0;

    const normalizedItems = items.map(item => {
      const qty = Number(item.quantity || 0);
      const cost = Number(item.cost_price || 0);
      const lineNet = qty * cost;

      const taxRate = taxMap[item.product_id] || 0;
      const lineTax = (lineNet * taxRate) / 100;

      netTotal += lineNet;
      taxTotal += lineTax;

      return {
        product_id: item.product_id,
        quantity: qty,
        cost_price: cost,
        expiry_date: item.expiry_date ?? null,
        reorder_level: item.reorder_level ?? null,
        max_stock: item.max_stock ?? null,
      };

    });

    netTotal = Number(netTotal.toFixed(2));
    taxTotal = Number(taxTotal.toFixed(2));
    const total_amount = Number((netTotal + taxTotal).toFixed(2));

    /* ======================================================
       3️⃣ GENERATE PURCHASE INVOICE NUMBER
    ====================================================== */
    const seq = await getNextPurchaseSequence(tenant_id);
    const year = new Date().getFullYear();
    const invoice_number = `PUR-${year}-${String(seq).padStart(4, "0")}`;

    /* ======================================================
       4️⃣ INSERT PURCHASE
    ====================================================== */
    const { data, error: rpcErr } = await supabase.rpc(
      "create_purchase_atomic",
      {
        p_tenant_id: tenant_id,
        p_supplier_id: supplier_id,
        p_invoice_number: invoice_number,
        p_net_total: netTotal,
        p_tax_total: taxTotal,
        p_total_amount: total_amount,
      }
    );

    if (rpcErr) throw rpcErr;
    if (!data) throw new Error("Purchase RPC returned no data");

    const purchase_id =
      typeof data === "number"
        ? data
        : Array.isArray(data)
          ? data[0]?.id
          : data.id;

    if (!purchase_id) {
      throw new Error("Invalid purchase_id returned from RPC");
    }
    // ✅ THIS is your purchase ID


    /* ======================================================
       5️⃣ INSERT PURCHASE ITEMS
    ====================================================== */
    const purchaseItemsData = normalizedItems.map(it => ({
      tenant_id,
      purchase_id,
      product_id: it.product_id,
      quantity: it.quantity,
      cost_price: it.cost_price,
    }));

    const { error: itemsErr } = await supabase
      .from("purchase_items")
      .insert(purchaseItemsData);

    if (itemsErr) throw itemsErr;

    /* ======================================================
       6️⃣ INVENTORY + STOCK MOVEMENTS
    ====================================================== */
    for (const it of normalizedItems) {
      const { data: existing } = await supabase
        .from("inventory")
        .select("id, quantity, stock_value, expiry_date, reorder_level, max_stock")

        .eq("tenant_id", tenant_id)
        .eq("product_id", it.product_id)
        .maybeSingle();

      if (existing) {
        const prevQty = Number(existing.quantity || 0);
        const prevValue = Number(existing.stock_value || 0);

        const newQty = prevQty + it.quantity;
        const newStockValue =
          prevValue + (it.quantity * it.cost_price);

        await supabase
          .from("inventory")
          .update({
            quantity: newQty,
            stock_value: newStockValue,   // ✅ FIX
            expiry_date: it.expiry_date ?? existing.expiry_date,
            reorder_level: it.reorder_level ?? existing.reorder_level,
            max_stock: it.max_stock ?? existing.max_stock,
            updated_at: new Date(),
          })
          .eq("id", existing.id);

      } else {
        await supabase.from("inventory").insert([{
          tenant_id,
          product_id: it.product_id,
          quantity: it.quantity,
          stock_value: it.quantity * it.cost_price, // ✅ FIX
          expiry_date: it.expiry_date,
          reorder_level: it.reorder_level,
          max_stock: it.max_stock,
        }]);

      }

      await supabase.from("stock_movements").insert([{
        tenant_id,
        product_id: it.product_id,
        movement_type: "purchase",
        reference_table: "purchases",
        reference_id: purchase_id,
        quantity: it.quantity,
      }]);
    }


    /* ======================================================
       7️⃣ ACCOUNTING (JOURNAL-ONLY SYSTEM)
    ====================================================== */
    const { data: coaAccounts, error: coaFetchErr } = await supabase
      .from("coa")
      .select("id, name, type")
      .eq("tenant_id", tenant_id);

    if (coaFetchErr) throw coaFetchErr;
    if (!coaAccounts || coaAccounts.length === 0) {
      throw new Error("Chart of Accounts not found for tenant");
    }

    const getAcc = (name, expectedType = null) => {
      const acc = coaAccounts.find(
        a => a.name.toLowerCase() === name.toLowerCase()
      );
      if (!acc) throw new Error(`COA missing: ${name}`);

      // ⚠️ VALIDATE ACCOUNT TYPE (CRITICAL FOR ACCOUNTING INTEGRITY)
      if (expectedType && acc.type !== expectedType) {
        throw new Error(
          `❌ ACCOUNTING ERROR: "${name}" должен быть "${expectedType}" но найден как "${acc.type}". ` +
          `Пожалуйста, исправьте таблицу COA.`
        );
      }

      return acc.id;
    };

    // ✅ FETCH ACCOUNTS WITH TYPE VALIDATION
    const inventoryAcc = getAcc("Inventory", "asset");
    const vatInputAcc = getAcc("VAT Input", "asset");
    const apAcc = getAcc("Accounts Payable", "liability"); // 🔥 THIS IS CRITICAL
    const cashAcc = getAcc("Cash", "asset");

    const bankAccObj = coaAccounts.find(a => a.name.toLowerCase() === "bank");
    const bankAcc = bankAccObj?.id;

    if (bankAccObj && bankAccObj.type !== "asset") {
      throw new Error(`❌ Bank account must be "asset", found "${bankAccObj.type}"`);
    }

    /* ======================================================
       DETERMINE CREDIT ACCOUNT BASED ON PAYMENT METHOD
       - credit = Purchase on credit → Accounts Payable (liability)
       - cash = Cash purchase → Cash (asset)
       - upi/card/bank = Bank purchase → Bank (asset)
    ====================================================== */
    const creditAccount =
      payment_method === "credit"
        ? apAcc
        : ["upi", "card", "bank"].includes(payment_method)
          ? bankAcc
          : cashAcc;

    if (!creditAccount) {
      throw new Error("Payment account not found in COA");
    }

    const desc = `Purchase #${invoice_number}`;

    /* ======================================================
       DAYBOOK - Human-readable entry
    ====================================================== */
    await supabase.from("daybook").insert([{
      tenant_id,
      entry_type: "purchase",
      description: desc,
      debit: total_amount,   // Total obligation created
      credit: 0,
      reference_id: purchase_id,
    }]);

    /* ======================================================
       DOUBLE-ENTRY ACCOUNTING:
       
       Dr Inventory (asset)          netTotal
          Cr Cash/Bank/AP                        netTotal
       
       Dr VAT Input (asset)          taxTotal
          Cr Cash/Bank/AP                        taxTotal
       
       This creates:
       - If CREDIT purchase: liability increases (AP credit)
       - If CASH/BANK purchase: asset decreases (Cash/Bank credit)
    ====================================================== */

    // INVENTORY CAPITALIZATION
    await addJournalEntry({
      tenant_id,
      debit_account: inventoryAcc,    // Asset increases
      credit_account: creditAccount,   // Cash/Bank/AP decreases/increases
      amount: netTotal,
      description: `${desc} - Inventory`,
      reference_id: purchase_id,
      reference_type: "purchase",
    });

    // VAT INPUT (Recoverable Tax)
    if (taxTotal > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: vatInputAcc,     // Asset increases (VAT recoverable)
        credit_account: creditAccount,   // Cash/Bank/AP decreases/increases
        amount: taxTotal,
        description: `${desc} - VAT Input`,
        reference_id: purchase_id,
        reference_type: "purchase",
      });
    }

    /* ======================================================
       8️⃣ VAT REPORT UPDATE (ATOMIC - FIXED)
    ====================================================== */
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // FIXED: Use atomic RPC to prevent race conditions
    const { error: vatError } = await supabase
      .rpc('increment_vat_report_purchase', {
        p_tenant_id: tenant_id,
        p_period: period,
        p_purchases: netTotal,
        p_vat: taxTotal
      });

    if (vatError) {
      console.error("⚠️ VAT report update failed (non-critical):", vatError);
      // Don't fail the purchase for VAT report issues
    }

    /* ======================================================
       ✅ FINAL RESPONSE
    ====================================================== */
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
    return res.status(500).json({
      error: err.message || "Server error",
    });
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

// DELETE /api/purchases/:id - Delete purchase (DISABLED FOR ACCOUNTING INTEGRITY)
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

    // ⚠️ PURCHASE DELETION IS DISABLED FOR ACCOUNTING INTEGRITY
    // Deleting a purchase would require:
    // 1. Reversing inventory increases
    // 2. Reversing all journal entries
    // 3. Reversing VAT report updates
    // 4. Reversing stock movements
    // 
    // Instead, use a "cancelled" status or purchase return flow

    return res.status(403).json({
      error: "Purchase deletion is disabled for accounting integrity",
      message: "To cancel a purchase, please use the purchase return functionality or contact support",
      purchase_number: existingPurchase.invoice_number,
      suggestion: "Use purchase returns to reverse transactions properly"
    });

    // ❌ OLD DANGEROUS CODE (COMMENTED OUT)
    // const { error: deleteItemsError } = await supabase
    //   .from("purchase_items")
    //   .delete()
    //   .eq("purchase_id", id)
    //   .eq("tenant_id", tenant_id);

    // if (deleteItemsError) throw deleteItemsError;

    // const { error: deletePurchaseError } = await supabase
    //   .from("purchases")
    //   .delete()
    //   .eq("id", id)
    //   .eq("tenant_id", tenant_id);

    // if (deletePurchaseError) throw deletePurchaseError;

    // return res.json({
    //   success: true,
    //   message: `✅ Purchase #${existingPurchase.invoice_number} deleted successfully!`,
    // });

  } catch (err) {
    console.error("❌ Purchase deletion attempt failed:", err);
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
    if (!tenant_id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { amount, payment_method = "cash" } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    /* ======================================================
       1️⃣ FETCH PURCHASE
    ====================================================== */
    const { data: purchase, error: purchaseErr } = await supabase
      .from("purchases")
      .select("id, total_amount, supplier_id")
      .eq("id", id)
      .eq("tenant_id", tenant_id)
      .single();

    if (purchaseErr || !purchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const supplier_id = purchase.supplier_id;

    /* ======================================================
       2️⃣ INSERT PAYMENT RECORD
    ====================================================== */
    const { error: payErr } = await supabase
      .from("purchase_payments")
      .insert([{
        tenant_id,
        purchase_id: id,
        supplier_id,
        amount,
        payment_method,
      }]);

    if (payErr) throw payErr;

    /* ======================================================
       3️⃣ COA LOOKUP WITH TYPE VALIDATION
    ====================================================== */
    const { data: coaAccounts, error: coaErr } = await supabase
      .from("coa")
      .select("id, name, type")
      .eq("tenant_id", tenant_id);

    if (coaErr) throw coaErr;
    if (!coaAccounts || coaAccounts.length === 0) {
      throw new Error("Chart of Accounts not found for tenant");
    }

    const getAcc = (name, expectedType = null) => {
      const acc = coaAccounts.find(
        a => a.name.toLowerCase() === name.toLowerCase()
      );
      if (!acc) throw new Error(`COA missing: ${name}`);

      // ⚠️ VALIDATE ACCOUNT TYPE
      if (expectedType && acc.type !== expectedType) {
        throw new Error(
          `❌ ACCOUNTING ERROR: "${name}" should be "${expectedType}" but found as "${acc.type}". ` +
          `Please fix COA table.`
        );
      }

      return acc.id;
    };

    // ✅ VALIDATE ACCOUNT TYPES
    const apAcc = getAcc("Accounts Payable", "liability");
    const cashAcc = getAcc("Cash", "asset");

    const bankAccObj = coaAccounts.find(
      a => a.name.toLowerCase() === "bank"
    );
    const bankAcc = bankAccObj?.id;

    if (bankAccObj && bankAccObj.type !== "asset") {
      throw new Error(`❌ Bank account must be "asset", found "${bankAccObj.type}"`);
    }

    /* ======================================================
       4️⃣ DETERMINE PAYMENT ACCOUNT
    ====================================================== */
    const paymentAcc =
      ["upi", "card", "bank"].includes(payment_method)
        ? bankAcc
        : cashAcc;

    if (!paymentAcc) {
      throw new Error("Payment account (Cash/Bank) not found in COA");
    }

    const desc = `Payment for Purchase #${id}`;

    /* ======================================================
       5️⃣ JOURNAL ENTRY (PAYMENT REVERSES LIABILITY)
       
       Dr Accounts Payable (liability)    amount
          Cr Cash/Bank (asset)                     amount
       
       This DECREASES liability and DECREASES cash/bank
    ====================================================== */
    await addJournalEntry({
      tenant_id,
      debit_account: apAcc,        // Liability decreases (debit)
      credit_account: paymentAcc,  // Asset decreases (credit)
      amount,
      description: desc,
      reference_id: id,
      reference_type: "purchase_payment",
    });

    /* ======================================================
       6️⃣ UPDATE PURCHASE PAID STATUS
    ====================================================== */
    const { data: payments } = await supabase
      .from("purchase_payments")
      .select("amount")
      .eq("tenant_id", tenant_id)
      .eq("purchase_id", id);

    const totalPaid =
      payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0;

    const isPaid = totalPaid >= Number(purchase.total_amount || 0);

    await supabase
      .from("purchases")
      .update({
        amount_paid: totalPaid,
        is_paid: isPaid,
        updated_at: new Date(),
      })
      .eq("id", id)
      .eq("tenant_id", tenant_id);

    /* ======================================================
       ✅ FINAL RESPONSE
    ====================================================== */
    return res.status(201).json({
      success: true,
      message: "Purchase payment recorded successfully",
      purchase_id: id,
      paid_amount: amount,
      total_paid: totalPaid,
      is_fully_paid: isPaid,
    });

  } catch (err) {
    console.error("❌ Payment failed:", err);
    return res.status(500).json({
      error: err.message || "Server Error",
    });
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
