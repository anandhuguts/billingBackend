import { supabase } from "../supabase/supabaseClient.js";

/* =========================================================
   ACCOUNTING HELPERS (same pattern as purchases / returns)
========================================================= */

async function addJournalEntry({
  tenant_id,
  debit_account,
  credit_account,
  amount,
  description,
  reference_id = null,
  reference_type = "sales_return",
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
  account_id = null, // should be COA id; we keep null to avoid FK clash
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
  const updatedBalance = Number(prev) + Number(debit) - Number(credit);

  const { error } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_type,
      account_id,
      entry_type,
      description,
      debit,
      credit,
      balance: updatedBalance,
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
   GET ALL SALES RETURNS
========================================================= */

export const getAllSalesReturns = async (req, res) => {
  try {
    const { invoice_id } = req.query;

    let q = supabase
      .from("sales_returns")
      .select(
        `
        *,
        products(name, sku),
        invoices(invoice_number),
        customers(name)
      `
      )
      .order("created_at", { ascending: false });

    if (req.user.role !== "super_admin") {
      q = q.eq("tenant_id", req.user.tenant_id);
    }

    if (invoice_id) q = q.eq("invoice_id", invoice_id);

    const { data, error } = await q;

    if (error) return res.status(500).json({ error: error.message });

    res.json({ sales_returns: data || [] });
  } catch (err) {
    console.error("getAllSalesReturns error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* =========================================================
   GET SALES RETURN BY ID
========================================================= */

export const getSalesReturnById = async (req, res) => {
  try {
    const { id } = req.params;

    let q = supabase
      .from("sales_returns")
      .select(
        `
        *,
        products(name, sku),
        invoices(invoice_number),
        customers(name)
      `
      )
      .eq("id", id);

    if (req.user.role !== "super_admin") {
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

/* =========================================================
   CREATE SALES RETURN
========================================================= */

export const createSalesReturn = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const {
      invoice_id,
      product_id,
      quantity,
      refund_type = "cash", // 'cash' | 'credit_note'
      reason = "",
      total_refund,
    } = req.body;

    if (!invoice_id || !product_id || !quantity || !total_refund) {
      return res.status(400).json({
        error:
          "invoice_id, product_id, quantity, and total_refund are required",
      });
    }

    const qty = Number(quantity);
    if (qty <= 0) {
      return res.status(400).json({ error: "Quantity must be > 0" });
    }

    const refundAmount = Number(total_refund);

    /* =========================
       1) Validate invoice & customer
    ========================= */
    /* =========================
   1) Validate invoice & customer
========================= */
    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .select("id, customer_id, tenant_id, invoice_number")
      .eq("id", invoice_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (invoiceErr) throw invoiceErr;
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Allow sales return for cash invoice (customer_id = null)
    // Only block if issuing credit note
    if (refund_type === "credit_note" && !invoice.customer_id) {
      return res.status(400).json({
        error: "Cannot issue credit note: invoice has no customer",
      });
    }

    const customer_id = invoice.customer_id || null;

    /* =========================
       2) Validate product is in that invoice & qty not exceeded
    ========================= */
    const { data: invoiceItems, error: invItemErr } = await supabase
      .from("invoice_items")
      .select("quantity")
      .eq("tenant_id", tenant_id)
      .eq("invoice_id", invoice_id)
      .eq("product_id", product_id);

    if (invItemErr) throw invItemErr;

    if (!invoiceItems || invoiceItems.length === 0) {
      return res
        .status(400)
        .json({ error: "Product not found in this invoice" });
    }

 /* =========================
   2) Validate product is in invoice AND remaining returnable quantity
========================= */

// Step A: Check how many were sold
const soldQty = invoiceItems.reduce(
  (sum, row) => sum + Number(row.quantity || 0),
  0
);

// Step B: Check how many were already returned
const { data: prevReturns, error: prevErr } = await supabase
  .from("sales_returns")
  .select("quantity")
  .eq("tenant_id", tenant_id)
  .eq("invoice_id", invoice_id)
  .eq("product_id", product_id);

if (prevErr) throw prevErr;

const returnedQty = prevReturns?.reduce(
  (sum, row) => sum + Number(row.quantity || 0),
  0
) || 0;

// Step C: Remaining qty allowed
const remainingQty = soldQty - returnedQty;

// Step D: Validate
if (remainingQty <= 0) {
  return res.status(400).json({
    error: "All sold quantity for this product has already been returned",
  });
}

if (qty > remainingQty) {
  return res.status(400).json({
    error: `Only ${remainingQty} units can be returned for this product`,
  });
}


    /* =========================
       3) Fetch product price & VAT
    ========================= */
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("selling_price, tax")
      .eq("tenant_id", tenant_id)
      .eq("id", product_id)
      .maybeSingle();

    if (prodErr) throw prodErr;
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const sellingPrice = Number(product.selling_price || 0);
    const taxRate = Number(product.tax || 0);

    const net = sellingPrice * qty;
    const vat = (net * taxRate) / 100;

    const netAmount = Number(net.toFixed(2));
    const taxAmount = Number(vat.toFixed(2));

    /* =========================
       4) Insert sales return
    ========================= */
    const { data: inserted, error: insertErr } = await supabase
      .from("sales_returns")
      .insert([
        {
          tenant_id,
          invoice_id,
          customer_id,
          product_id,
          quantity: qty,
          refund_type,
          reason,
          total_refund: refundAmount,
        },
      ])
      .select(
        `
        *,
        products(name, sku),
        invoices(invoice_number),
        customers(name)
      `
      )
      .single();

    if (insertErr) throw insertErr;

    const sales_return_id = inserted.id;

    /* =========================
       5) Increase Inventory + Stock Movement
    ========================= */
    const { data: existingInv } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("tenant_id", tenant_id)
      .eq("product_id", product_id)
      .maybeSingle();

    if (existingInv) {
      await supabase
        .from("inventory")
        .update({
          quantity: Number(existingInv.quantity || 0) + qty,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingInv.id);
    } else {
      // If no inventory exists, create new row
      await supabase.from("inventory").insert([
        {
          tenant_id,
          product_id,
          quantity: qty,
          updated_at: new Date().toISOString(),
        },
      ]);
    }

    // stock_movements.movement_type = 'sale_return' (per schema)
    await supabase.from("stock_movements").insert([
      {
        tenant_id,
        product_id,
        movement_type: "sale_return",
        reference_table: "sales_returns",
        reference_id: sales_return_id,
        quantity: qty,
      },
    ]);

    /* =========================
       6) Accounting Entries
    ========================= */

    const coaMap = await getCoaMap(tenant_id);
    const desc = `Sales Return #${sales_return_id} (Invoice #${
      invoice.invoice_number || invoice_id
    })`;

    // Daybook: money going OUT (refund/cn) → credit
    await supabase.from("daybook").insert([
      {
        tenant_id,
        entry_type: "sales_return",
        description: desc,
        debit: 0,
        credit: refundAmount,
        reference_id: sales_return_id,
      },
    ]);

    // ----- Ledger + Journal -----
    if (refund_type === "cash") {
      // Cash refund

      // Ledger: Cash CREDIT
      await insertLedgerEntry({
        tenant_id,
        account_type: "cash",
        account_id: null,
        entry_type: "credit",
        description: desc,
        debit: 0,
        credit: refundAmount,
        reference_id: sales_return_id,
      });

      // Ledger: Sales DEBIT (reverse revenue)
      await insertLedgerEntry({
        tenant_id,
        account_type: "sales",
        account_id: null,
        entry_type: "debit",
        description: desc,
        debit: netAmount,
        credit: 0,
        reference_id: sales_return_id,
      });

      // Ledger: VAT Output DEBIT (reverse VAT)
      if (taxAmount > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "vat_output",
          account_id: null,
          entry_type: "debit",
          description: `${desc} VAT reversal`,
          debit: taxAmount,
          credit: 0,
          reference_id: sales_return_id,
        });
      }

      // Journal: Debit Sales, Credit Cash (net)
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "sales"),
        credit_account: coaId(coaMap, "cash"),
        amount: netAmount,
        description: `${desc} - Sales reversal`,
        reference_id: sales_return_id,
        reference_type: "sales_return",
      });

      // Journal: Debit VAT Output, Credit Cash (tax)
      if (taxAmount > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "vat output"),
          credit_account: coaId(coaMap, "cash"),
          amount: taxAmount,
          description: `${desc} - VAT reversal`,
          reference_id: sales_return_id,
          reference_type: "sales_return",
        });
      }
    } else {
      // CREDIT NOTE (Accounts Receivable increase)

      // Ledger: Accounts Receivable DEBIT (customer owes less)
      await insertLedgerEntry({
        tenant_id,
        account_type: "accounts_receivable",
        account_id: null,
        entry_type: "debit",
        description: desc,
        debit: refundAmount,
        credit: 0,
        reference_id: sales_return_id,
      });

      // Ledger: Sales DEBIT
      await insertLedgerEntry({
        tenant_id,
        account_type: "sales",
        account_id: null,
        entry_type: "debit",
        description: desc,
        debit: netAmount,
        credit: 0,
        reference_id: sales_return_id,
      });

      // Ledger: VAT Output DEBIT
      if (taxAmount > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "vat_output",
          account_id: null,
          entry_type: "debit",
          description: `${desc} VAT reversal`,
          debit: taxAmount,
          credit: 0,
          reference_id: sales_return_id,
        });
      }

      // Journal: Debit AR, Credit Sales (net)
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "accounts receivable"),
        credit_account: coaId(coaMap, "sales"),
        amount: netAmount,
        description: `${desc} - Sales reversal`,
        reference_id: sales_return_id,
        reference_type: "sales_return",
      });

      // Journal: Debit AR, Credit VAT Output (tax)
      if (taxAmount > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "accounts receivable"),
          credit_account: coaId(coaMap, "vat output"),
          amount: taxAmount,
          description: `${desc} - VAT reversal`,
          reference_id: sales_return_id,
          reference_type: "sales_return",
        });
      }
    }

    /* =========================
       7) VAT REPORT UPDATE
    ========================= */

    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;

    const { data: vatRow } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("period", period)
      .maybeSingle();

    const prevTotalSales = Number(vatRow?.total_sales || 0);
    const prevSalesVat = Number(vatRow?.sales_vat || 0);
    const prevPurchaseVat = Number(vatRow?.purchase_vat || 0);

    const newSales = prevTotalSales - netAmount;
    const newSalesVat = prevSalesVat - taxAmount;
    const newVatPayable = newSalesVat - prevPurchaseVat;

    if (vatRow) {
      await supabase
        .from("vat_reports")
        .update({
          total_sales: newSales,
          sales_vat: newSalesVat,
          vat_payable: newVatPayable,
        })
        .eq("id", vatRow.id);
    } else {
      await supabase.from("vat_reports").insert([
        {
          tenant_id,
          period,
          total_sales: -netAmount,
          sales_vat: -taxAmount,
          total_purchases: 0,
          purchase_vat: 0,
          vat_payable: -taxAmount,
        },
      ]);
    }

    /* =========================
       8) RESPONSE
    ========================= */
    res.status(201).json({
      success: true,
      sales_return: inserted,
    });
  } catch (err) {
    console.error("Sales Return Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================================================
   UPDATE SALES RETURN
   (NOTE: does NOT auto reverse inventory/accounting)
========================================================= */

export const updateSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.tenant_id && req.user.role !== "super_admin") {
      delete updates.tenant_id;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    let q = supabase.from("sales_returns").update(updates).eq("id", id);

    if (req.user.role !== "super_admin") {
      q = q.eq("tenant_id", req.user.tenant_id);
    }

    const { data, error } = await q.select(
      "*, products(name, sku), invoices(invoice_number), customers(name)"
    );

    if (error) return res.status(500).json({ error: error.message });

    if (!data?.length) {
      return res
        .status(404)
        .json({ error: "Sales return not found or forbidden" });
    }

    res.json({ sales_return: data[0] });
  } catch (err) {
    console.error("updateSalesReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* =========================================================
   DELETE SALES RETURN
   (NOTE: does NOT reverse accounting/stock; use with care)
========================================================= */

export const deleteSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;

    let q = supabase.from("sales_returns").delete().eq("id", id);

    if (req.user.role !== "super_admin") {
      q = q.eq("tenant_id", req.user.tenant_id);
    }

    const { data, error } = await q.select();

    if (error) return res.status(500).json({ error: error.message });

    if (!data?.length) {
      return res
        .status(404)
        .json({ error: "Sales return not found or forbidden" });
    }

    res.json({ message: "Deleted", sales_return: data[0] });
  } catch (err) {
    console.error("deleteSalesReturn error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
