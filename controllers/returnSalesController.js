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
    const tenantId = req.user?.tenant_id;
    const role = req.user?.role;
    const { invoice_id } = req.query;

    // Pagination
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // Base query
    let q = supabase
      .from("sales_returns")
    .select(`
  *,
  invoices(invoice_number),
  customers(name),
  sales_return_items(
    id,
    quantity,
    price,
    tax_rate,
    line_total,
    products(id, name, sku)
  )
`, { count: "exact" })
      .order("created_at", { ascending: false });

    // Restrict tenant scope unless superadmin
    if (role !== "superadmin") {
      q = q.eq("tenant_id", tenantId);
    }

    // Filter by invoice if passed
    if (invoice_id) q = q.eq("invoice_id", invoice_id);

    // Apply pagination
    const { data, error, count } = await q.range(start, end);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      success: true,
      page,
      limit,
      totalRecords: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      data: data || []
    });

  } catch (err) {
    console.error("getAllSalesReturns error", err);
    return res.status(500).json({ error: "Internal server error" });
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
      refund_type = "cash",
      reason = "",
      total_refund,          // optional
      items,                 // <-- array of { product_id, quantity }
    } = req.body;
    console.log("Create Sales Return:", req.body);

    if (!invoice_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "invoice_id and items[] (with at least one item) are required",
      });
    }

    // 1) Validate invoice & customer
    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .select("id, customer_id, tenant_id, invoice_number")
      .eq("id", invoice_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (invoiceErr) throw invoiceErr;
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    if (refund_type === "credit_note" && !invoice.customer_id) {
      return res.status(400).json({
        error: "Cannot issue credit note: invoice has no customer",
      });
    }

    const customer_id = invoice.customer_id || null;

    // 2) Preload invoice items (all products on this invoice)
    const { data: allInvoiceItems, error: invItemsErr } = await supabase
      .from("invoice_items")
      .select("product_id, quantity")
      .eq("tenant_id", tenant_id)
      .eq("invoice_id", invoice_id);

    if (invItemsErr) throw invItemsErr;
    if (!allInvoiceItems?.length) {
      return res
        .status(400)
        .json({ error: "No items found on this invoice" });
    }

    const soldQtyByProduct = {};
    allInvoiceItems.forEach((row) => {
      soldQtyByProduct[row.product_id] =
        (soldQtyByProduct[row.product_id] || 0) + Number(row.quantity || 0);
    });

    // 3) Preload previous returns for this invoice
    const { data: prevReturnItems, error: prevRetErr } = await supabase
      .from("sales_return_items")
      .select("product_id, quantity")
      .eq("tenant_id", tenant_id)
      .eq("invoice_id", invoice_id);

    if (prevRetErr) throw prevRetErr;

    const returnedQtyByProduct = {};
    prevReturnItems?.forEach((row) => {
      returnedQtyByProduct[row.product_id] =
        (returnedQtyByProduct[row.product_id] || 0) + Number(row.quantity || 0);
    });

    // 4) Preload products (price, tax, cost)
    const productIds = [...new Set(items.map((i) => i.product_id))];

    const { data: products, error: productsErr } = await supabase
      .from("products")
      .select("id, selling_price, tax, cost_price")
      .eq("tenant_id", tenant_id)
      .in("id", productIds);

    if (productsErr) throw productsErr;

    const productMap = {};
    products?.forEach((p) => {
      productMap[p.id] = p;
    });

    // 5) Create main sales_return row (without totals yet)
    const { data: salesReturnRow, error: salesRetErr } = await supabase
      .from("sales_returns")
      .insert([
        {
          tenant_id,
          invoice_id,
          customer_id,
          refund_type,
          reason,
          total_refund: 0, // will update later
        },
      ])
      .select("*")
      .single();

    if (salesRetErr) throw salesRetErr;

    const sales_return_id = salesReturnRow.id;

    // 6) Loop items, validate qty, compute amounts, prepare rows
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;
    let totalCost = 0;

    const itemsToInsert = [];

    for (const item of items) {
      const product_id = item.product_id;
      const qty = Number(item.quantity);

      if (!product_id || !qty || qty <= 0) {
        throw new Error("Each item must have product_id and qty > 0");
      }

      const soldQty = Number(soldQtyByProduct[product_id] || 0);
      if (!soldQty) {
        throw new Error(`Product ${product_id} not found in this invoice`);
      }

      const prevReturned = Number(returnedQtyByProduct[product_id] || 0);
      const remaining = soldQty - prevReturned;

      if (remaining <= 0) {
        throw new Error(
          `All quantity already returned for product ${product_id}`
        );
      }
      if (qty > remaining) {
        throw new Error(
          `Only ${remaining} units can be returned for product ${product_id}`
        );
      }

      const product = productMap[product_id];
      if (!product) {
        throw new Error(`Product not found: ${product_id}`);
      }

      const sellingPrice = Number(product.selling_price || 0); // tax inclusive
      const taxRate = Number(product.tax || 0);
      const costPrice = Number(product.cost_price || 0);       // for COGS

      // VAT-inclusive breakup
      const divisor = 1 + taxRate / 100;
      const lineGross = sellingPrice * qty;
      const base = lineGross / divisor;
      const vat = lineGross - base;

      const netAmount = Number(base.toFixed(2));
      const taxAmount = Number(vat.toFixed(2));
      const lineTotal = Number(lineGross.toFixed(2));

      const lineCost = Number((costPrice * qty).toFixed(2));

      totalNet += netAmount;
      totalVat += taxAmount;
      totalGross += lineTotal;
      totalCost += lineCost;

      itemsToInsert.push({
        tenant_id,
        sales_return_id,
        invoice_id,
        product_id,
        quantity: qty,
        price: sellingPrice,
        tax_rate: taxRate,
        net_amount: netAmount,
        tax_amount: taxAmount,
        line_total: lineTotal,
        cost_price: costPrice,
        cost_total: lineCost,
      });

      // 6a) Inventory update
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
        await supabase.from("inventory").insert([
          {
            tenant_id,
            product_id,
            quantity: qty,
            updated_at: new Date().toISOString(),
          },
        ]);
      }

      // 6b) Stock movement
      await supabase.from("stock_movements").insert([
        {
          tenant_id,
          product_id,
          movement_type: "sale_return",
          reference_table: "sales_returns",
          reference_id: sales_return_id,
          quantity: qty, // positive (stock in)
        },
      ]);
    }

    // 7) Insert all sales_return_items
    const { data: insertedItems, error: itemsErr } = await supabase
      .from("sales_return_items")
      .insert(itemsToInsert)
      .select("*");

    if (itemsErr) throw itemsErr;

    // Totals
    const totalNetRounded = Number(totalNet.toFixed(2));
    const totalVatRounded = Number(totalVat.toFixed(2));
    const totalGrossRounded = Number(totalGross.toFixed(2));
    const totalCostRounded = Number(totalCost.toFixed(2));

    const refundAmount =
      total_refund != null ? Number(total_refund) : totalGrossRounded;

    // 8) Update master sales_return with total_refund
    await supabase
      .from("sales_returns")
      .update({ total_refund: refundAmount })
      .eq("id", sales_return_id);

    // 9) Accounting: ledger + journal + daybook
    const coaMap = await getCoaMap(tenant_id);
    const desc = `Sales Return #${sales_return_id} (Invoice #${
      invoice.invoice_number || invoice_id
    })`;

    // Daybook – money going OUT (refund / credit) → credit
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

    // 9a) Reverse revenue and VAT (same for cash or credit_note)
    if (refund_type === "cash") {
      // Cash refund
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
    } else {
      // Credit note → customer owes less
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
    }

    // Reverse Sales
    await insertLedgerEntry({
      tenant_id,
      account_type: "sales",
      account_id: null,
      entry_type: "debit",
      description: desc,
      debit: totalNetRounded,
      credit: 0,
      reference_id: sales_return_id,
    });

    // Reverse VAT Output
    if (totalVatRounded > 0) {
      await insertLedgerEntry({
        tenant_id,
        account_type: "vat_output",
        account_id: null,
        entry_type: "debit",
        description: `${desc} VAT reversal`,
        debit: totalVatRounded,
        credit: 0,
        reference_id: sales_return_id,
      });
    }

    // 9b) Reverse COGS & Inventory (goods came back)
    if (totalCostRounded > 0) {
      await insertLedgerEntry({
        tenant_id,
        account_type: "inventory",
        account_id: null,
        entry_type: "debit",
        description: `${desc} - Inventory increase`,
        debit: totalCostRounded,
        credit: 0,
        reference_id: sales_return_id,
      });

      await insertLedgerEntry({
        tenant_id,
        account_type: "cogs",
        account_id: null,
        entry_type: "credit",
        description: `${desc} - COGS reversal`,
        debit: 0,
        credit: totalCostRounded,
        reference_id: sales_return_id,
      });
    }

    // Journal entries
    if (refund_type === "cash") {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "sales"),
        credit_account: coaId(coaMap, "cash"),
        amount: totalNetRounded,
        description: `${desc} - Sales reversal`,
        reference_id: sales_return_id,
        reference_type: "sales_return",
      });

      if (totalVatRounded > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "vat output"),
          credit_account: coaId(coaMap, "cash"),
          amount: totalVatRounded,
          description: `${desc} - VAT reversal`,
          reference_id: sales_return_id,
          reference_type: "sales_return",
        });
      }
    } else {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "accounts receivable"),
        credit_account: coaId(coaMap, "sales"),
        amount: totalNetRounded,
        description: `${desc} - Sales reversal`,
        reference_id: sales_return_id,
        reference_type: "sales_return",
      });

      if (totalVatRounded > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId(coaMap, "accounts receivable"),
          credit_account: coaId(coaMap, "vat output"),
          amount: totalVatRounded,
          description: `${desc} - VAT reversal`,
          reference_id: sales_return_id,
          reference_type: "sales_return",
        });
      }
    }

    // COGS reversal journal
    if (totalCostRounded > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "inventory"),
        credit_account: coaId(coaMap, "cogs"),
        amount: totalCostRounded,
        description: `${desc} - COGS reversal`,
        reference_id: sales_return_id,
        reference_type: "sales_return",
      });
    }

    // 10) VAT report update
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

    const newSales = prevTotalSales - totalNetRounded;
    const newSalesVat = prevSalesVat - totalVatRounded;
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
          total_sales: -totalNetRounded,
          sales_vat: -totalVatRounded,
          total_purchases: 0,
          purchase_vat: 0,
          vat_payable: -totalVatRounded,
        },
      ]);
    }

    // 11) RESPONSE
    res.status(201).json({
      success: true,
      sales_return: {
        ...salesReturnRow,
        total_refund: refundAmount,
        items: insertedItems,
      },
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
