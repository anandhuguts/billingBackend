import { supabase } from "../supabase/supabaseClient.js";

/* =========================================================
   ACCOUNTING HELPERS (same style as other modules)
========================================================= */

async function addJournalEntry({
  tenant_id,
  debit_account,
  credit_account,
  amount,
  description,
  reference_id = null,
  reference_type = "purchase_return",
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

async function insertLedgerEntry({
  tenant_id,
  account_type,
  account_id = null, // MUST be COA id; we keep null to avoid FK clash
  entry_type,
  description,
  debit = 0,
  credit = 0,
  reference_id = null,
}) {
  const { data: lastRows } = await supabase
    .from("ledger_entries")
    .select("balance")
    .eq("tenant_id", tenant_id)
    .eq("account_type", account_type)
    .order("created_at", { ascending: false })
    .limit(1);

  const prev = lastRows?.[0]?.balance || 0;
  const balance = Number(prev) + Number(debit) - Number(credit);

  const { error } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_type,
      account_id, // keep null or COA id only
      entry_type,
      description,
      debit,
      credit,
      balance,
      reference_id,
    },
  ]);

  if (error) throw error;
}

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
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { data, error } = await supabase
      .from("purchase_returns")
      .select(
        `
        *,
        products(name, sku),
        purchases(invoice_number),
        suppliers(name)
      `
      )
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ purchase_returns: data || [] });
  } catch (err) {
    console.error("getAllPurchaseReturns error", err);
    res.status(500).json({ error: "Internal server error" });
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
    if (qty > Number(purchaseItem.quantity)) {
      return res
        .status(400)
        .json({ error: "Cannot return more than purchased quantity" });
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

    const coaMap = await getCoaMap(tenant_id);
    const desc = `Purchase Return #${purchase_return_id} (Purchase #${
      purchase.invoice_number || purchase_id
    })`;

    // ---- 5.1 Daybook ----
    // Purchase Return = money IN / liability reduced → DEBIT
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

    // ---- 5.2 Ledger + Journal ----
    if (refund_method === "cash") {
      // ---- CASH REFUND: Supplier gives us cash ----

      // Ledger: Cash DEBIT
      await insertLedgerEntry({
        tenant_id,
        account_type: "cash",
        account_id: null,
        entry_type: "debit",
        description: desc,
        debit: refundAmount,
        credit: 0,
        reference_id: purchase_return_id,
      });

      // Ledger: Inventory CREDIT (reduce stock asset)
      await insertLedgerEntry({
        tenant_id,
        account_type: "inventory",
        account_id: null,
        entry_type: "credit",
        description: desc,
        debit: 0,
        credit: netAmount,
        reference_id: purchase_return_id,
      });

      // Ledger: VAT Input CREDIT (reduce input VAT)
      if (taxAmount > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "vat_input",
          account_id: null,
          entry_type: "credit",
          description: `${desc} VAT reversal`,
          debit: 0,
          credit: taxAmount,
          reference_id: purchase_return_id,
        });
      }

      // Journal: Dr Cash, Cr Inventory (net)
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "cash"),
        credit_account: coaId(coaMap, "inventory"),
        amount: netAmount,
        description: `${desc} - Inventory reversal`,
        reference_id: purchase_return_id,
      });

      // Journal: Dr Cash, Cr VAT Input (tax)
      if (taxAmount > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "cash"),
          credit_account: coaId(coaMap, "vat input"),
          amount: taxAmount,
          description: `${desc} - VAT reversal`,
          reference_id: purchase_return_id,
        });
      }
    } else {
      // ---- CREDIT NOTE ----
      // Supplier reduces our payable (liability decreases)

      // Ledger: Accounts Payable DEBIT (reduce liability)
      await insertLedgerEntry({
        tenant_id,
        account_type: "accounts_payable",
        account_id: null, // DO NOT put supplier_id here (FK to COA)
        entry_type: "debit",
        description: desc,
        debit: refundAmount,
        credit: 0,
        reference_id: purchase_return_id,
      });

      // Ledger: Inventory CREDIT
      await insertLedgerEntry({
        tenant_id,
        account_type: "inventory",
        account_id: null,
        entry_type: "credit",
        description: desc,
        debit: 0,
        credit: netAmount,
        reference_id: purchase_return_id,
      });

      // Ledger: VAT Input CREDIT
      if (taxAmount > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "vat_input",
          account_id: null,
          entry_type: "credit",
          description: `${desc} VAT reversal`,
          debit: 0,
          credit: taxAmount,
          reference_id: purchase_return_id,
        });
      }

      // Journal: Dr Accounts Payable, Cr Inventory (net)
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "accounts payable"),
        credit_account: coaId(coaMap, "inventory"),
        amount: netAmount,
        description: `${desc} - Inventory reversal`,
        reference_id: purchase_return_id,
      });

      // Journal: Dr Accounts Payable, Cr VAT Input (tax)
      if (taxAmount > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "accounts payable"),
          credit_account: coaId(coaMap, "vat input"),
          amount: taxAmount,
          description: `${desc} - VAT reversal`,
          reference_id: purchase_return_id,
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
