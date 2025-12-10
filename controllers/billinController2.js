// controllers/invoiceController.js - COMPLETE OPTIMIZED VERSION
import { supabase } from "../supabase/supabaseClient.js";
import { addJournalEntry } from "../services/addJournalEntryService.js";
import { insertLedgerEntry } from "../services/insertLedgerEntryService.js";
import { calculateEmployeeDiscount } from "../services/calculateEmployeeDiscountServices.js";
import { applyDiscounts } from "../services/applyDiscountsService.js";
import { generatePDF } from "../scripts/pdfGenerator.js";

/**
 * ============================================
 * DEFERRED OPERATIONS - RUNS AFTER RESPONSE
 * ============================================
 */
async function processDeferredOperations(params) {
  const {
    tenant_id,
    invoice,
    itemsWithDiscounts,
    customer,
    customer_id,
    isLoyaltyCustomer,
    total_amount,
    payment_method,
    item_discount_total,
    bill_discount_total,
    employee_discount_total,
    redeem_points,
    earn_points,
    currentPoints,
    lifetimePoints,
    coaAccounts,
    baseUrl,
    businessName,
    invoiceItemsToInsert,
  } = params;

  try {
    console.log(`🔄 Starting deferred operations for invoice ${invoice.id}`);

    // 🟡 UPDATE CUSTOMER POINTS AFTER REDEEM (IMPORTANT FIX)
if (isLoyaltyCustomer && redeem_points > 0) {
  await supabase
    .from("customers")
    .update({
      loyalty_points: currentPoints,   // reduced balance
      lifetime_points: lifetimePoints, // lifetime doesn't change on redeem
      last_purchase_at: new Date(),
    })
    .eq("id", customer_id)
    .eq("tenant_id", tenant_id);
}


    // Helper to get COA ID
    function coaId(name) {
      const acc = coaAccounts.find(
        (a) => a.name.toLowerCase() === name.toLowerCase()
      );
      if (!acc) throw new Error(`COA account not found: ${name}`);
      return acc.id;
    }

    // ==========================================
    // 1) LOYALTY POINTS - UPDATE CUSTOMER
    // ==========================================
    if (isLoyaltyCustomer && earn_points > 0) {
      await supabase
        .from("customers")
        .update({
          loyalty_points: currentPoints,
          lifetime_points: lifetimePoints,
          last_purchase_at: new Date(),
          total_purchases: (customer.total_purchases || 0) + 1,
          total_spent: Number(customer.total_spent || 0) + total_amount,
        })
        .eq("id", customer_id);

      await supabase.from("loyalty_transactions").insert([
        {
          customer_id,
          invoice_id: invoice.id,
          transaction_type: "earn",
          points: earn_points,
          balance_after: currentPoints,
          description: `Earned ${earn_points} points for invoice #${invoice.id}`,
        },
      ]);
    }

    // ==========================================
    // 2) ACCOUNTING ENTRIES
    // ==========================================
    const saleAmount = total_amount;
    const saleDescription = `Invoice #${invoice.invoice_number || invoice.id}`;

    // Calculate tax total
    const totalTax = itemsWithDiscounts.reduce(
      (s, it) => s + Number(it.taxAmount || 0),
      0
    );
    const netSales = Math.max(0, saleAmount - totalTax);

    // 2.1) DAYBOOK ENTRY
    await supabase.from("daybook").insert([
      {
        tenant_id,
        entry_type: "sale",
        description: saleDescription,
        debit: 0,
        credit: saleAmount,
        reference_id: invoice.id,
      },
    ]);

    // 2.2) LEDGER ENTRIES
    const paymentAccountType =
      payment_method === "credit" ? "Accounts Receivable" : "cash";

    // Debit: Cash or Receivable
    await insertLedgerEntry({
      tenant_id,
      account_type: paymentAccountType,
      account_id: payment_method === "credit" ? customer_id : null,
      entry_type: "debit",
      description: saleDescription,
      debit: saleAmount,
      credit: 0,
      reference_id: invoice.id,
    });

    // Credit: Sales
    if (netSales > 0) {
      await insertLedgerEntry({
        tenant_id,
        account_type: "sales",
        account_id: null,
        entry_type: "credit",
        description: saleDescription,
        debit: 0,
        credit: netSales,
        reference_id: invoice.id,
      });
    }

    // Credit: VAT Payable
    if (totalTax > 0) {
      await insertLedgerEntry({
        tenant_id,
        account_type: "VAT Payable",
        account_id: null,
        entry_type: "credit",
        description: `VAT for ${saleDescription}`,
        debit: 0,
        credit: totalTax,
        reference_id: invoice.id,
      });
    }

    // 2.3) JOURNAL ENTRIES
    if (payment_method !== "credit") {
      // CASH SALE
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Cash"),
        credit_account: coaId("Sales"),
        amount: netSales,
        description: saleDescription,
        reference_id: invoice.id,
      });

      if (totalTax > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Cash"),
          credit_account: coaId("VAT Payable"),
          amount: totalTax,
          description: `VAT for ${saleDescription}`,
          reference_id: invoice.id,
        });
      }
    } else {
      // CREDIT SALE
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Accounts Receivable"),
        credit_account: coaId("Sales"),
        amount: netSales,
        description: saleDescription,
        reference_id: invoice.id,
      });

      if (totalTax > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Accounts Receivable"),
          credit_account: coaId("VAT Payable"),
          amount: totalTax,
          description: `VAT for ${saleDescription}`,
          reference_id: invoice.id,
        });
      }
    }

    // 2.4) DISCOUNT JOURNAL ENTRIES
    if (item_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Discount Expense"),
        credit_account: coaId("Sales"),
        amount: item_discount_total,
        description: `Item discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    if (employee_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Staff Discount Expense"),
        credit_account: coaId("Sales"),
        amount: employee_discount_total,
        description: `Employee discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    if (bill_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Discount Expense"),
        credit_account: coaId("Sales"),
        amount: bill_discount_total,
        description: `Bill discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    // ==========================================
    // 3) COGS & INVENTORY ACCOUNTING
    // ==========================================
    for (const it of itemsWithDiscounts) {
      const { data: prod } = await supabase
        .from("products")
        .select("cost_price")
        .eq("id", it.product_id)
        .maybeSingle();

      if (!prod || prod.cost_price == null) continue;

      const unitCost = Number(prod.cost_price);
      const lineCost = unitCost * Number(it.qty || 0);

      if (lineCost <= 0) continue;

      // Journal: DR COGS, CR Inventory
      await addJournalEntry({
        tenant_id,
        debit_account: coaId("Cost of Goods Sold"),
        credit_account: coaId("Inventory"),
        amount: lineCost,
        description: `COGS for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });

      // Ledger: DR COGS
      await insertLedgerEntry({
        tenant_id,
        account_type: "cogs",
        entry_type: "debit",
        description: `COGS for invoice #${invoice.id}`,
        debit: lineCost,
        credit: 0,
        reference_id: invoice.id,
      });

      // Ledger: CR Inventory
      await insertLedgerEntry({
        tenant_id,
        account_type: "inventory",
        entry_type: "credit",
        description: `Inventory reduction for invoice #${invoice.id}`,
        debit: 0,
        credit: lineCost,
        reference_id: invoice.id,
      });
    }

    // ==========================================
    // 4) VAT REPORT UPDATE
    // ==========================================
    const now = invoice.created_at ? new Date(invoice.created_at) : new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const { data: existingVat } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("period", period)
      .maybeSingle();

    if (existingVat) {
      const newTotalSales = Number(existingVat.total_sales || 0) + Number(saleAmount || 0);
      const newSalesVat = Number(existingVat.sales_vat || 0) + Number(totalTax || 0);
      const newPurchaseVat = Number(existingVat.purchase_vat || 0);
      const newVatPayable = newSalesVat - newPurchaseVat;

      await supabase
        .from("vat_reports")
        .update({
          total_sales: newTotalSales,
          sales_vat: newSalesVat,
          vat_payable: newVatPayable,
        })
        .eq("id", existingVat.id);
    } else {
      await supabase.from("vat_reports").insert([
        {
          tenant_id,
          period,
          total_sales: saleAmount,
          sales_vat: totalTax,
          total_purchases: 0,
          purchase_vat: 0,
          vat_payable: totalTax,
        },
      ]);
    }

    // ==========================================
    // 5) PDF GENERATION
    // ==========================================
    const productIds = [...new Set(invoiceItemsToInsert.map((i) => i.product_id))];
    const { data: productNames } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);

    const productMap = {};
    (productNames || []).forEach((p) => {
      productMap[p.id] = p.name;
    });

    const itemsWithNames = invoiceItemsToInsert.map((it) => ({
      ...it,
      name: productMap[it.product_id] || "Unknown",
    }));

    const subtotal = itemsWithDiscounts.reduce((s, it) => s + it.lineGross, 0);

    await generatePDF({
      invoiceNumber: invoice.invoice_number,
      items: itemsWithNames,
      total: total_amount,
      payment_method,
      subtotal,
      baseUrl,
      businessName,
    });

    console.log(`✅ Deferred operations completed for invoice ${invoice.id}`);
  } catch (err) {
    console.error(`❌ Deferred operations failed for invoice ${invoice.id}:`, err);
    // Log to error tracking service if available
  }
}

/**
 * ============================================
 * MAIN INVOICE CREATION - FAST PATH
 * ============================================
 */
export const createInvoice = async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const businessName = req.user.full_name || "SUPERMART";

  try {
    const tenant_id = req.user.tenant_id;
    const {
      items = [],
      payment_method = "cash",
      customer_id = null,
      redeem_points = 0,
      coupon_code = null,
    } = req.body;

    console.log("📥 Invoice request:", req.body);

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // ==========================================
    // STEP 1: PARALLEL DATA FETCHING
    // ==========================================
    const productIds = items.map((i) => i.product_id);

    const [productDataResult, customerResult, coaResult] = await Promise.all([
      supabase.from("products").select("id, selling_price, tax").in("id", productIds),
      customer_id
        ? supabase
            .from("customers")
            .select("id, loyalty_points, lifetime_points, total_purchases, total_spent, membership_tier")
            .eq("id", customer_id)
            .eq("tenant_id", tenant_id)
            .single()
        : { data: null, error: null },
      supabase.from("coa").select("id, name").eq("tenant_id", tenant_id),
    ]);

    const { data: productData, error: prodErr } = productDataResult;
    if (prodErr) {
      return res.status(500).json({ error: "Failed to fetch product info" });
    }

    // Merge items with backend prices
    const mergedItems = items.map((i) => {
      const p = productData.find((x) => x.id === i.product_id);
      if (!p) throw new Error(`Product not found: ${i.product_id}`);
      return {
        product_id: i.product_id,
        qty: i.qty,
        price: Number(p.selling_price),
        tax: Number(p.tax),
      };
    });

    // ==========================================
    // STEP 2: CUSTOMER & DISCOUNT PROCESSING
    // ==========================================
    const isLoyaltyCustomer = !!customer_id;
    let customer = null;

    if (isLoyaltyCustomer) {
      if (customerResult.error || !customerResult.data) {
        return res.status(404).json({ error: "Customer not found" });
      }
      customer = customerResult.data;
    }

    // Apply discounts
    let discountResult;
    try {
      discountResult = await applyDiscounts({
        items: mergedItems,
        tenant_id,
        customer,
        couponCode: coupon_code,
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
      invoiceDiscounts,
      appliedCouponRule,
    } = discountResult;

    // Employee discount
    const { discount: employee_discount_total } = await calculateEmployeeDiscount({
      tenant_id,
      buyer_employee_id: req.body.employee_id || null,
      subtotal,
    });

    let total_amount = total_before_redeem - employee_discount_total;

    // ==========================================
    // STEP 3: COUPON VALIDATION
    // ==========================================
    if (appliedCouponRule && isLoyaltyCustomer && appliedCouponRule.per_customer_limit) {
      const { data: usesByCustomer } = await supabase
        .from("coupon_usage")
        .select("id")
        .eq("coupon_id", appliedCouponRule.id)
        .eq("customer_id", customer_id);

      if (usesByCustomer && usesByCustomer.length >= appliedCouponRule.per_customer_limit) {
        return res.status(400).json({ error: "Coupon usage limit reached for this customer" });
      }
    }

    // ==========================================
    // STEP 4: LOYALTY POINTS REDEMPTION
    // ==========================================
    let currentPoints = customer ? Number(customer.loyalty_points || 0) : 0;
    let lifetimePoints = customer ? Number(customer.lifetime_points || 0) : 0;

    if (isLoyaltyCustomer && redeem_points > 0) {
      if (redeem_points > currentPoints) {
        return res.status(400).json({ error: "Not enough loyalty points" });
      }

   total_amount = total_amount - redeem_points; // no rounding here
currentPoints = currentPoints - redeem_points;


      await supabase.from("loyalty_transactions").insert([
        {
          customer_id,
          invoice_id: null,
          transaction_type: "redeem",
          points: -redeem_points,
          balance_after: currentPoints,
          description: `Redeemed ${redeem_points} points`,
        },
      ]);
    }

    if (total_amount < 0) total_amount = 0;

    // ==========================================
    // STEP 5: GENERATE INVOICE NUMBER
    // ==========================================
    const { data: counter } = await supabase
      .from("tenant_counters")
      .select("sales_seq")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    let seq = 1;
    if (!counter) {
      await supabase.from("tenant_counters").insert([{ tenant_id, sales_seq: 1 }]);
    } else {
      seq = counter.sales_seq + 1;
      await supabase
        .from("tenant_counters")
        .update({ sales_seq: seq })
        .eq("tenant_id", tenant_id);
    }

    const year = new Date().getFullYear();
    const invoice_number = `INV-${year}-${String(seq).padStart(4, "0")}`;

    // ==========================================
    // STEP 6: CREATE INVOICE RECORD
    // ==========================================
    const insertPayload = {
      tenant_id,
      invoice_number,
      handled_by: req.user.id,
      customer_id: isLoyaltyCustomer ? customer_id : null,
      total_amount,
      payment_method,
      item_discount_total,
      bill_discount_total,
      coupon_discount_total,
      membership_discount_total,
      employee_discount_total,
      final_amount: total_amount,
    };

    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .insert([insertPayload])
      .select("*")
      .single();

    if (invoiceErr) {
      console.error("❌ Invoice insert error:", invoiceErr);
      return res.status(500).json({ error: invoiceErr.message });
    }

    if (!invoice) {
      console.error("❌ Invoice insert returned null");
      return res.status(500).json({ error: "Invoice creation failed" });
    }

    // ==========================================
    // STEP 7: UPDATE RELATED RECORDS
    // ==========================================
    const relatedUpdates = [];

    // Attach invoice_id to loyalty redemption
    if (isLoyaltyCustomer && redeem_points > 0) {
      relatedUpdates.push(
        supabase
          .from("loyalty_transactions")
          .update({ invoice_id: invoice.id })
          .eq("customer_id", customer_id)
          .is("invoice_id", null)
      );
    }

    // Attach invoice_id to employee discount
    if (employee_discount_total > 0) {
      relatedUpdates.push(
        supabase
          .from("employee_discount_usage")
          .update({ invoice_id: invoice.id })
          .eq("employee_id", req.body.employee_id)
          .is("invoice_id", null)
      );
    }

    await Promise.all(relatedUpdates);

    // ==========================================
    // STEP 8: INSERT INVOICE ITEMS
    // ==========================================
    const invoiceItemsToInsert = itemsWithDiscounts.map((it) => {
      const qty = Number(it.qty || 0);
      const price = Number(it.price || 0);
      const discountPerUnit = Number(it.discount_amount || 0);
      const netUnit = price - discountPerUnit;
      const lineTotal = netUnit * qty;

      return {
        tenant_id,
        invoice_id: invoice.id,
        product_id: it.product_id,
        quantity: qty,
        price,
        tax: it.tax,
        tax_amount: Number(it.taxAmount || 0),
        discount_amount: discountPerUnit,
        net_price: netUnit,
        total: lineTotal,
      };
    });

    await supabase.from("invoice_items").insert(invoiceItemsToInsert);

    // ==========================================
    // STEP 9: INSERT INVOICE DISCOUNTS
    // ==========================================
    if (invoiceDiscounts.length > 0) {
      const discountInserts = invoiceDiscounts.map((invDisc) => ({
        invoice_id: invoice.id,
        rule_id: invDisc.rule_id,
        amount: invDisc.amount,
        description: invDisc.description,
      }));
      await supabase.from("invoice_discounts").insert(discountInserts);
    }

    // ==========================================
    // STEP 10: RECORD COUPON USAGE
    // ==========================================
    if (appliedCouponRule) {
      await supabase.from("coupon_usage").insert([
        {
          customer_id: isLoyaltyCustomer ? customer_id : null,
          coupon_id: appliedCouponRule.id,
          invoice_id: invoice.id,
        },
      ]);
    }

    // ==========================================
    // STEP 11: UPDATE INVENTORY (CRITICAL)
    // ==========================================
    const lowStockAlerts = [];
    const inventoryUpdates = [];

    for (const it of itemsWithDiscounts) {
      const { data: invData } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", it.product_id)
        .maybeSingle();

      if (!invData) {
        throw new Error(
          `Inventory not found for product_id ${it.product_id}. Add inventory via PURCHASE first.`
        );
      }

      const newQty = Math.max(0, Number(invData.quantity || 0) - it.qty);

      inventoryUpdates.push(
        supabase
          .from("inventory")
          .update({ quantity: newQty })
          .eq("id", invData.id)
          .eq("tenant_id", tenant_id)
      );

      if (newQty <= Number(invData.reorder_level || 0)) {
        lowStockAlerts.push({
          product_id: it.product_id,
          newQty,
          reorder_level: invData.reorder_level,
        });
      }
    }

    await Promise.all(inventoryUpdates);

    // ==========================================
    // STEP 12: INSERT STOCK MOVEMENTS
    // ==========================================
    const stockMovements = itemsWithDiscounts.map((it) => ({
      tenant_id,
      product_id: it.product_id,
      movement_type: "sale",
      reference_table: "invoices",
      reference_id: invoice.id,
      quantity: -Number(it.qty),
      created_at: new Date().toISOString(),
    }));

    await supabase.from("stock_movements").insert(stockMovements);

    // ==========================================
    // STEP 13: CALCULATE EARN POINTS
    // ==========================================
    let earn_points = 0;
    if (isLoyaltyCustomer) {
      const { data: earnRule } = await supabase
        .from("loyalty_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (earnRule && earnRule.points_per_currency && earnRule.currency_unit) {
        const currency_unit = Number(earnRule.currency_unit || 100);
        const points_per_currency = Number(earnRule.points_per_currency || 1);
        earn_points = Math.floor((total_amount / currency_unit) * points_per_currency);
      } else {
        earn_points = Math.floor(total_amount / 100);
      }

      currentPoints += earn_points;
      lifetimePoints += earn_points;
    }

    // ==========================================
    // ⚡ SEND IMMEDIATE RESPONSE
    // ==========================================
    const response = {
      message: "Invoice created successfully",
      invoice: {
        ...invoice,
        subtotal,
        final_amount: total_amount,
        pdf_url: `${baseUrl}/invoices/invoice-${invoice_number}.pdf`,
      },
      items: invoiceItemsToInsert,
      lowStockAlerts,
      loyalty: isLoyaltyCustomer
        ? {
            earned: earn_points,
            redeemed: redeem_points,
            final_balance: currentPoints,
          }
        : null,
    };

    res.status(201).json(response);

    // ==========================================
    // 🔄 START DEFERRED OPERATIONS
    // ==========================================
    setImmediate(() => {
      processDeferredOperations({
        tenant_id,
        invoice,
        itemsWithDiscounts,
        customer,
        customer_id,
        isLoyaltyCustomer,
        total_amount,
        payment_method,
        item_discount_total,
        bill_discount_total,
        employee_discount_total,
        redeem_points,
        earn_points,
        currentPoints,
        lifetimePoints,
        coaAccounts: coaResult.data || [],
        baseUrl,
        businessName,
        invoiceItemsToInsert,
      });
    });

    console.log(`✅ Invoice ${invoice_number} created - deferred ops queued`);
  } catch (err) {
    console.error("❌ createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};