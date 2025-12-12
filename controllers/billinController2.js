// controllers/invoiceController.js
// FULL OPTIMIZED VERSION WITH setImmediate BACKGROUND TASKS
// USING REAL COA ACCOUNTS: COGS → "Cost of Goods Sold" & VAT → "VAT Output"

import { supabase } from "../supabase/supabaseClient.js";
import { addJournalEntry } from "../services/addJournalEntryService.js";
import { calculateEmployeeDiscount } from "../services/calculateEmployeeDiscountServices.js";
import { applyDiscounts } from "../services/applyDiscountsService.js";
import { generatePDF } from "../scripts/pdfGenerator.js";

/**
 * ============================================================
 * HELPER: GET ACCOUNT ID BY NAME FROM COA ARRAY
 * ============================================================
 */
function getAccountId(name, coaAccounts) {
  const acc = coaAccounts.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!acc) throw new Error(`COA account not found: ${name}`);
  return acc.id;
}

/**
 * ============================================================
 * DEFERRED OPERATIONS (runs after response via setImmediate)
 * ============================================================
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
    console.log(`🔄 Running deferred operations for invoice ${invoice.id}`);

    /**
     * ======================================================
     * 1) LOYALTY — UPDATE CUSTOMER AFTER REDEEM + EARN
     * ======================================================
     */
    if (isLoyaltyCustomer) {
      await supabase
        .from("customers")
        .update({
          loyalty_points: currentPoints,
          lifetime_points: lifetimePoints,
          last_purchase_at: new Date(),
          total_purchases: (customer.total_purchases || 0) + 1,
          total_spent: Number(customer.total_spent || 0) + total_amount,
        })
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id);

      if (earn_points > 0) {
        await supabase.from("loyalty_transactions").insert([{
          customer_id,
          invoice_id: invoice.id,
          transaction_type: "earn",
          points: earn_points,
          balance_after: currentPoints,
          description: `Earned ${earn_points} points`,
        }]);
      }
    }

    /**
     * ======================================================
     * 2) ACCOUNTING ENTRIES
     * ======================================================
     */

    const saleAmount = total_amount;
    const totalTax = itemsWithDiscounts.reduce((s, it) => s + Number(it.taxAmount || 0), 0);
    const netSales = Math.max(0, saleAmount - totalTax);
    const saleDescription = `Invoice #${invoice.invoice_number || invoice.id}`;

    // COA IDs mapped using your actual COA:
    const cashAcc = getAccountId("Cash", coaAccounts);
    const arAcc = getAccountId("Accounts Receivable", coaAccounts);
    const salesAcc = getAccountId("Sales", coaAccounts);
    const vatOutputAcc = getAccountId("VAT Output", coaAccounts);
    const discountAcc = getAccountId("Discount Expense", coaAccounts);
    const staffDiscountAcc = getAccountId("Staff Discount Expense", coaAccounts);
    const cogsAcc = getAccountId("Cost of Goods Sold", coaAccounts);
    const inventoryAcc = getAccountId("Inventory", coaAccounts);

    /**
     * 2.1) DAYBOOK ENTRY
     */
    await supabase.from("daybook").insert([{
      tenant_id,
      entry_type: "sale",
      description: saleDescription,
      debit: 0,
      credit: saleAmount,
      reference_id: invoice.id,
    }]);

    /**
     * 2.2) JOURNAL ENTRIES
     */
    if (payment_method !== "credit") {
      // CASH SALE
      await addJournalEntry({
        tenant_id,
        debit_account: cashAcc,
        credit_account: salesAcc,
        amount: netSales,
        description: saleDescription,
        reference_id: invoice.id,
      });

      if (totalTax > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: cashAcc,
          credit_account: vatOutputAcc,
          amount: totalTax,
          description: `VAT Output for ${saleDescription}`,
          reference_id: invoice.id,
        });
      }
    } else {
      // CREDIT SALE
      await addJournalEntry({
        tenant_id,
        debit_account: arAcc,
        credit_account: salesAcc,
        amount: netSales,
        description: saleDescription,
        reference_id: invoice.id,
      });

      if (totalTax > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: arAcc,
          credit_account: vatOutputAcc,
          amount: totalTax,
          description: `VAT Output for ${saleDescription}`,
          reference_id: invoice.id,
        });
      }
    }

    /**
     * 2.3) DISCOUNTS AS EXPENSE ENTRIES
     */
    if (item_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: discountAcc,
        credit_account: salesAcc,
        amount: item_discount_total,
        description: `Item Discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    if (bill_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: discountAcc,
        credit_account: salesAcc,
        amount: bill_discount_total,
        description: `Bill Discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    if (employee_discount_total > 0) {
      await addJournalEntry({
        tenant_id,
        debit_account: staffDiscountAcc,
        credit_account: salesAcc,
        amount: employee_discount_total,
        description: `Staff Discount for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    /**
     * ======================================================
     * 3) COGS + INVENTORY ACCOUNTING
     * ======================================================
     */
    for (const it of itemsWithDiscounts) {
      const { data: prod } = await supabase
        .from("products")
        .select("cost_price")
        .eq("id", it.product_id)
        .maybeSingle();

      if (!prod || !prod.cost_price) continue;

      const lineCost = Number(prod.cost_price) * Number(it.qty);

      await addJournalEntry({
        tenant_id,
        debit_account: cogsAcc,
        credit_account: inventoryAcc,
        amount: lineCost,
        description: `COGS for invoice #${invoice.id}`,
        reference_id: invoice.id,
      });
    }

    /**
     * ======================================================
     * 4) VAT REPORT UPDATE (MONTHLY)
     * ======================================================
     */
    const now = new Date(invoice.created_at || new Date());
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const { data: existingVat } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("period", period)
      .maybeSingle();

    if (existingVat) {
      await supabase.from("vat_reports").update({
        total_sales: Number(existingVat.total_sales || 0) + saleAmount,
        sales_vat: Number(existingVat.sales_vat || 0) + totalTax,
        vat_payable: (Number(existingVat.sales_vat || 0) + totalTax) - Number(existingVat.purchase_vat || 0),
      }).eq("id", existingVat.id);
    } else {
      await supabase.from("vat_reports").insert([{
        tenant_id,
        period,
        total_sales: saleAmount,
        sales_vat: totalTax,
        total_purchases: 0,
        purchase_vat: 0,
        vat_payable: totalTax,
      }]);
    }

    

    console.log(`✅ Deferred operations completed for invoice ${invoice.id}`);

  } catch (err) {
    console.error(`❌ Deferred operations failed:`, err);
  }
}

/**
 * ============================================================
 * MAIN INVOICE CREATION — FAST RESPONSE HANDLER
 * ============================================================
 */
// (Continue from PART 1 - ensure PART 1 content is present above this block)

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

    // -----------------------------
    // STEP 1: FETCH PRODUCTS + COA + CUSTOMER (parallel)
    // -----------------------------
    const productIds = items.map((i) => i.product_id);

    const [
      productDataResult,
      customerResult,
      coaResult
    ] = await Promise.all([
      supabase.from("products").select("id, selling_price, tax, cost_price").in("id", productIds),
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
      console.error("Product fetch error:", prodErr);
      return res.status(500).json({ error: "Failed to fetch product info" });
    }

    const coaAccounts = (coaResult && coaResult.data) || [];
    if (!coaAccounts || coaAccounts.length === 0) {
      return res.status(500).json({ error: "COA accounts missing for tenant" });
    }

    // Merge items with backend prices and taxes (server authoritative)
    const mergedItems = items.map((i) => {
      const p = productData.find((x) => x.id === i.product_id);
      if (!p) throw new Error(`Product not found: ${i.product_id}`);
      return {
        product_id: i.product_id,
        qty: Number(i.qty || 0),
        price: Number(p.selling_price),
        tax: Number(p.tax || 0),
        cost_price: p.cost_price != null ? Number(p.cost_price) : null,
      };
    });

    // -----------------------------
    // STEP 2: CUSTOMER & DISCOUNTS
    // -----------------------------
    const isLoyaltyCustomer = !!customer_id;
    let customer = null;
    if (isLoyaltyCustomer) {
      if (customerResult.error || !customerResult.data) {
        return res.status(404).json({ error: "Customer not found" });
      }
      customer = customerResult.data;
    }

    // apply discounts (this may throw if coupon invalid)
    let discountResult;
    try {
      discountResult = await applyDiscounts({
        items: mergedItems,
        tenant_id,
        customer,
        couponCode: coupon_code,
      });
    } catch (err) {
      console.error("applyDiscounts error:", err);
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

    // employee discount
    const { discount: employee_discount_total } = await calculateEmployeeDiscount({
      tenant_id,
      buyer_employee_id: req.body.employee_id || null,
      subtotal,
    });

    let total_amount = total_before_redeem - employee_discount_total;

    // -----------------------------
    // STEP 3: COUPON VALIDATION (per-customer)
    // -----------------------------
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

    // -----------------------------
    // STEP 4: REDEEM POINTS (record a temp transaction; attach invoice after)
    // -----------------------------
    let currentPoints = customer ? Number(customer.loyalty_points || 0) : 0;
    let lifetimePoints = customer ? Number(customer.lifetime_points || 0) : 0;

    if (isLoyaltyCustomer && redeem_points > 0) {
      if (redeem_points > currentPoints) {
        return res.status(400).json({ error: "Not enough loyalty points" });
      }

      total_amount = Number((total_amount - redeem_points).toFixed(2));
      currentPoints -= redeem_points;

      await supabase.from("loyalty_transactions").insert([{
        customer_id,
        invoice_id: null,
        transaction_type: "redeem",
        points: -redeem_points,
        balance_after: currentPoints,
        description: `Redeemed ${redeem_points} points`,
      }]);
    }

    if (total_amount < 0) total_amount = 0;

    // -----------------------------
    // STEP 5: GENERATE INVOICE NUMBER (atomic-ish)
    // -----------------------------
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

    // -----------------------------
    // STEP 6: INSERT INVOICE
    // -----------------------------
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
      console.error("Invoice insert error:", invoiceErr);
      return res.status(500).json({ error: invoiceErr.message });
    }

    if (!invoice) {
      console.error("Invoice insert returned null");
      return res.status(500).json({ error: "Invoice creation failed" });
    }

    // -----------------------------
    // STEP 7: ATTACH RELATED TEMP RECORDS
    // -----------------------------
    const relatedUpdates = [];

    if (isLoyaltyCustomer && redeem_points > 0) {
      relatedUpdates.push(
        supabase
          .from("loyalty_transactions")
          .update({ invoice_id: invoice.id })
          .eq("customer_id", customer_id)
          .is("invoice_id", null)
      );
    }

    if (employee_discount_total > 0) {
      relatedUpdates.push(
        supabase
          .from("employee_discount_usage")
          .update({ invoice_id: invoice.id })
          .eq("employee_id", req.body.employee_id)
          .is("invoice_id", null)
      );
    }

    if (relatedUpdates.length > 0) await Promise.all(relatedUpdates);

    // -----------------------------
    // STEP 8: INSERT INVOICE ITEMS
    // -----------------------------
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

    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItemsToInsert);

    if (itemsError) {
      console.error("Invoice items insert error:", itemsError);
      throw itemsError;
    }

    // -----------------------------
    // STEP 9: INSERT INVOICE DISCOUNTS
    // -----------------------------
    if (invoiceDiscounts && invoiceDiscounts.length > 0) {
      const discountInserts = invoiceDiscounts.map((invDisc) => ({
        invoice_id: invoice.id,
        rule_id: invDisc.rule_id,
        amount: invDisc.amount,
        description: invDisc.description,
      }));
      await supabase.from("invoice_discounts").insert(discountInserts);
    }

    // -----------------------------
    // STEP 10: RECORD COUPON USAGE
    // -----------------------------
    if (appliedCouponRule) {
      await supabase.from("coupon_usage").insert([{
        customer_id: isLoyaltyCustomer ? customer_id : null,
        coupon_id: appliedCouponRule.id,
        invoice_id: invoice.id,
      }]);
    }

    // -----------------------------
    // STEP 11: UPDATE INVENTORY (synchronous)
    // -----------------------------
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

    if (inventoryUpdates.length > 0) await Promise.all(inventoryUpdates);

    // -----------------------------
    // STEP 12: INSERT STOCK MOVEMENTS
    // -----------------------------
    const stockMovements = itemsWithDiscounts.map((it) => ({
      tenant_id,
      product_id: it.product_id,
      movement_type: "sale",
      reference_table: "invoices",
      reference_id: invoice.id,
      quantity: -Number(it.qty),
      created_at: new Date().toISOString(),
    }));

    if (stockMovements.length > 0) {
      await supabase.from("stock_movements").insert(stockMovements);
    }

    // -----------------------------
    // STEP 13: CALCULATE EARN POINTS (deferred update)
    // -----------------------------
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

    // -----------------------------
    // STEP 14: UPDATE INVOICE FINAL TOTALS
    // -----------------------------
    await supabase
      .from("invoices")
      .update({
        item_discount_total,
        bill_discount_total,
        coupon_discount_total,
        membership_discount_total,
        employee_discount_total,
        final_amount: total_amount,
      })
      .eq("id", invoice.id);

    // -----------------------------
    // STEP 15: FETCH PRODUCT NAMES FOR RESPONSE
    // -----------------------------
    const uniqueProductIds = [...new Set(invoiceItemsToInsert.map(i => i.product_id))];
    const { data: productNames } = await supabase
      .from("products")
      .select("id, name")
      .in("id", uniqueProductIds);

    const productMap = {};
    (productNames || []).forEach(p => (productMap[p.id] = p.name));

    const itemsWithNames = invoiceItemsToInsert.map((it) => ({
      ...it,
      name: productMap[it.product_id] || "Unknown",
    }));

    // -----------------------------
    // STEP 16: PREPARE RESPONSE (fast) & QUEUE DEFERRED OPS
    // -----------------------------
    // const response = {
    //   message: "Invoice created successfully",
    //   invoice: {
    //     ...invoice,
    //     subtotal,
    //     final_amount: total_amount,
    //     pdf_url: `${baseUrl}/invoices/invoice-${invoice_number}.pdf`,
    //   },
    //   items: itemsWithNames,
    //   lowStockAlerts,
    //   loyalty: isLoyaltyCustomer
    //     ? {
    //         earned: earn_points,
    //         redeemed: redeem_points,
    //         final_balance: currentPoints,
    //       }
    //     : null,
    // };

    // --- Generate PDF before sending response ---
// -----------------------------
// STEP 16: Generate PDF before sending response
// -----------------------------
const pdfBuffer = await generatePDF({
  invoiceNumber: invoice_number,
  items: itemsWithNames,
  total: total_amount,
  payment_method,
  subtotal,
  baseUrl,
  businessName,
});

// -----------------------------
// STEP 17: Start deferred operations
// -----------------------------
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
    coaAccounts,
    baseUrl,
    businessName,
    invoiceItemsToInsert,
  });
});

console.log(`✅ Invoice ${invoice_number} created — PDF sent, deferred ops queued.`);

// -----------------------------
// STEP 18: SEND PDF AND END RESPONSE
// -----------------------------
res.setHeader("Content-Type", "application/pdf");
res.setHeader(
  "Content-Disposition",
  `attachment; filename=invoice-${invoice_number}.pdf`
);

return res.send(pdfBuffer);


    
  } catch (err) {
    console.error("❌ createInvoice error:", err);
    // If headers already sent, just log
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "Server error" });
    }
  }
};
