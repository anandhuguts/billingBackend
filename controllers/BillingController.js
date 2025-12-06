// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { addJournalEntry } from "../services/addJournalEntryService.js";
import { insertLedgerEntry } from "../services/insertLedgerEntryService.js";
import { calculateEmployeeDiscount } from "../services/calculateEmployeeDiscountServices.js";
import { applyDiscounts } from "../services/applyDiscountsService.js";
import { generatePDF } from "../scripts/pdfGenerator.js";

/**
 * Add a journal entry (double-entry)
 * debit_account = COA id
 * credit_account = COA id
 */


/**
 * LEDGER entry with running balance by (tenant_id, account_type)
 * account_type is a string, like: 'inventory', 'vat_input', 'cash', 'accounts_payable'
 */
// async function insertLedgerEntry({
//   tenant_id,
//   account_type,
//   account_id = null,
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

/**
 * Discount engine: applyDiscounts
 * - Selling price is INCLUSIVE of tax
 * - Returns items with per-unit discount_amount & net_price
 * - Also returns invoice-level discount totals
 */

// ==============================
// EMPLOYEE DISCOUNT CALCULATOR
// ==============================
// async function calculateEmployeeDiscount({
//   tenant_id,
//   buyer_employee_id,
//   logged_in_user,
//   subtotal,
//   invoice_id
// }) {
//   // 1) Must provide employee_id in body
//   if (!buyer_employee_id) return { discount: 0 };

//   // 2) Only the same employee can bill themselves
//   if (buyer_employee_id !== logged_in_user.id) return { discount: 0 };

//   // 3) Must be staff role
//   if (logged_in_user.role !== "staff") return { discount: 0 };

//   // 4) Get employee discount rule
//   const { data: rules } = await supabase
//     .from("employee_discount_rules")
//     .select("*")
//     .eq("tenant_id", tenant_id)
//     .eq("is_active", true)
//     .limit(1);

//   if (!rules?.length) return { discount: 0 };
//   const rule = rules[0];

//   // Base discount
//   let discount = (subtotal * Number(rule.discount_percent || 0)) / 100;

//   // Per bill max
//   if (rule.max_discount_amount && discount > rule.max_discount_amount) {
//     discount = rule.max_discount_amount;
//   }

//   // Monthly limit check
//   if (rule.monthly_limit) {
//     const now = new Date();
//     const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
//     const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

//     const { data: used } = await supabase
//       .from("employee_discount_usage")
//       .select("discount_amount")
//       .eq("tenant_id", tenant_id)
//       .eq("employee_id", buyer_employee_id)
//       .gte("used_at", start)
//       .lt("used_at", next);

//     const usedAmt = used?.reduce((t, r) => t + Number(r.discount_amount), 0) || 0;
//     const remaining = rule.monthly_limit - usedAmt;

//     if (remaining <= 0) discount = 0;
//     else if (discount > remaining) discount = remaining;
//   }

//   // Insert TEMP record (invoice_id assigned later)
//  if (discount > 0 && buyer_employee_id === logged_in_user.id) {
//     await supabase.from("employee_discount_usage").insert([
//       {
//         tenant_id,
//         employee_id: buyer_employee_id,
//         invoice_id,
//         discount_amount: discount,
//       },
//     ]);
//   }

//   return { discount };
// }


// export async function applyDiscounts({
//   items,
//   tenant_id,
//   customer = null,
//   couponCode = null,
// }) {
//   // fetch active discount rules for tenant
//   const { data: rules = [], error: rulesErr } = await supabase
//     .from("discount_rules")
//     .select("*")
//     .eq("tenant_id", tenant_id)
//     .eq("is_active", true);

//   if (rulesErr) throw rulesErr;

//   const itemRules = rules.filter((r) => r.type === "item");
//   const billRules = rules.filter((r) => r.type === "bill");
//   const couponRules = rules.filter((r) => r.type === "coupon");
//   const tierRules = rules.filter((r) => r.type === "tier");

//   // normalize items
//   // price = inclusive selling price per unit
//   const workingItems = items.map((it) => {
//     const unitGross = Number(it.price || 0); // inclusive per unit
//     const qty = Number(it.qty || 0);
//     const taxPercent = Number(it.tax || 0);

//     const divisor = 1 + taxPercent / 100;
//     let unitBase = unitGross;
//     let unitTax = 0;

//     if (taxPercent > 0) {
//       unitBase = unitGross / divisor;
//       unitTax = unitGross - unitBase;
//     }

//     const lineGross = unitGross * qty; // inclusive total (before item discount)
//     const lineBase = unitBase * qty;
//     const lineTax = unitTax * qty;

//     return {
//       ...it,
//       qty,
//       unitGross,
//       taxPercent,
//       unitBase,
//       unitTax,
//       lineGross,
//       lineBase,
//       lineTax,
//       lineDiscount: 0, // total discount for the line (not per-unit)
//       perUnitDiscount: 0,
//       netUnitGross: unitGross,
//       netLineGross: lineGross,
//       netLineBase: lineBase,
//       netLineTax: lineTax,
//     };
//   });

//   const invoiceDiscounts = [];

//   // -----------------------------------------
//   // 1) ITEM-LEVEL DISCOUNTS (on inclusive line total)
//   // -----------------------------------------
//   for (const rule of itemRules) {
//     for (const it of workingItems) {
//       if (
//         rule.product_id &&
//         Number(rule.product_id) === Number(it.product_id)
//       ) {
//         let extraLineDiscount = 0;

//         if (Number(rule.discount_percent || 0) > 0) {
//           extraLineDiscount =
//             (it.lineGross * Number(rule.discount_percent)) / 100;
//         } else if (Number(rule.discount_amount || 0) > 0) {
//           extraLineDiscount = Number(rule.discount_amount) * it.qty;
//         }

//         const remaining = it.lineGross - it.lineDiscount;
//         extraLineDiscount = Math.max(0, Math.min(extraLineDiscount, remaining));

//         it.lineDiscount += extraLineDiscount;
//       }
//     }
//   }

//   // recompute per-unit and net values AFTER item discounts
//   for (const it of workingItems) {
//     if (it.qty > 0) {
//       it.perUnitDiscount = it.lineDiscount / it.qty;
//       it.netUnitGross = it.unitGross - it.perUnitDiscount;
//       it.netLineGross = it.netUnitGross * it.qty;

//       const divisor = 1 + it.taxPercent / 100;
//       if (it.taxPercent > 0) {
//         it.netLineBase = it.netLineGross / divisor;
//         it.netLineTax = it.netLineGross - it.netLineBase;
//       } else {
//         it.netLineBase = it.netLineGross;
//         it.netLineTax = 0;
//       }
//     } else {
//       it.perUnitDiscount = 0;
//       it.netUnitGross = it.unitGross;
//       it.netLineGross = it.lineGross;
//       it.netLineBase = it.lineBase;
//       it.netLineTax = it.lineTax;
//     }
//   }

//   const subtotal = workingItems.reduce((s, it) => s + it.lineGross, 0);
//   const item_discount_total = workingItems.reduce(
//     (s, it) => s + it.lineDiscount,
//     0
//   );
//   let total_after_item = Number((subtotal - item_discount_total).toFixed(2));

//   // -----------------------------------------
//   // 2) BILL-LEVEL DISCOUNT
//   // -----------------------------------------
//   let bill_discount_total = 0;

//   for (const rule of billRules) {
//     if (
//       rule.min_bill_amount &&
//       total_after_item < Number(rule.min_bill_amount)
//     ) {
//       continue;
//     }

//     let amt = 0;

//     if (Number(rule.discount_percent || 0) > 0) {
//       amt = (total_after_item * Number(rule.discount_percent)) / 100;
//     } else if (Number(rule.discount_amount || 0) > 0) {
//       amt = Number(rule.discount_amount);
//     }

//     amt = Math.max(0, Math.min(amt, total_after_item - bill_discount_total));

//     if (amt > 0) {
//       bill_discount_total = Number((bill_discount_total + amt).toFixed(2));
//       invoiceDiscounts.push({
//         rule_id: rule.id,
//         amount: Number(amt.toFixed(2)),
//         description: `Bill discount rule ${rule.id}`,
//       });
//     }
//   }

//   let total_after_bill = Number(
//     (total_after_item - bill_discount_total).toFixed(2)
//   );

//   // -----------------------------------------
//   // 3) COUPON DISCOUNT
//   // -----------------------------------------
//   let coupon_discount_total = 0;
//   let appliedCouponRule = null;

//   if (couponCode) {
//     const rule = couponRules.find(
//       (r) =>
//         r.code &&
//         String(r.code).toLowerCase() === String(couponCode).toLowerCase()
//     );

//     if (!rule) throw new Error("Invalid coupon code");

//     if (Number(rule.min_bill_amount || 0) > total_after_bill) {
//       throw new Error("Coupon minimum bill not satisfied");
//     }

//     if (rule.max_uses) {
//       const { data: uses } = await supabase
//         .from("coupon_usage")
//         .select("id")
//         .eq("coupon_id", rule.id);

//       if (uses && uses.length >= rule.max_uses)
//         throw new Error("Coupon usage limit reached");
//     }

//     if (Number(rule.discount_percent || 0) > 0) {
//       coupon_discount_total = Number(
//         ((total_after_bill * Number(rule.discount_percent)) / 100).toFixed(2)
//       );
//     } else if (Number(rule.discount_amount || 0) > 0) {
//       coupon_discount_total = Math.min(
//         Number(rule.discount_amount),
//         total_after_bill
//       );
//     }

//     if (coupon_discount_total > 0) {
//       appliedCouponRule = rule;
//       invoiceDiscounts.push({
//         rule_id: rule.id,
//         amount: coupon_discount_total,
//         description: `Coupon ${rule.code}`,
//       });
//     }
//   }

//   let total_after_coupon = Number(
//     (total_after_bill - coupon_discount_total).toFixed(2)
//   );

//   // -----------------------------------------
//   // 4) MEMBERSHIP TIER DISCOUNT
//   // -----------------------------------------
//   let membership_discount_total = 0;

//   if (customer && customer.membership_tier) {
//     const tierRule = tierRules.find(
//       (tr) =>
//         tr.tier &&
//         String(tr.tier).toLowerCase() ===
//           String(customer.membership_tier).toLowerCase()
//     );

//     if (tierRule) {
//       if (Number(tierRule.discount_percent || 0) > 0) {
//         membership_discount_total = Number(
//           (
//             (total_after_coupon * Number(tierRule.discount_percent)) /
//             100
//           ).toFixed(2)
//         );
//       } else if (Number(tierRule.discount_amount || 0) > 0) {
//         membership_discount_total = Math.min(
//           Number(tierRule.discount_amount),
//           total_after_coupon
//         );
//       }

//       if (membership_discount_total > 0) {
//         invoiceDiscounts.push({
//           rule_id: tierRule.id,
//           amount: membership_discount_total,
//           description: `Membership ${tierRule.tier} discount`,
//         });
//       }
//     }
//   }

//   const total_after_membership = Number(
//     (total_after_coupon - membership_discount_total).toFixed(2)
//   );
//   const total_before_redeem = Number(total_after_membership.toFixed(2));

//   // -----------------------------------------
//   // RETURN FINAL STRUCTURE
//   // discount_amount = per-unit discount
//   // net_price = per-unit net inclusive price
//   // taxAmount = tax AFTER item discount
//   // -----------------------------------------
//   return {
//     items: workingItems.map((it) => ({
//       product_id: it.product_id,
//       qty: it.qty,
//       price: Number(it.unitGross.toFixed(2)), // inclusive per unit
//       tax: it.taxPercent,
//       lineBase: Number(it.netLineBase.toFixed(2)),
//       taxAmount: Number(it.netLineTax.toFixed(2)),
//       baseWithTax: Number(it.netLineGross.toFixed(2)),
//       discount_amount: Number((it.perUnitDiscount || 0).toFixed(2)),
//       net_price: Number((it.netUnitGross || it.unitGross).toFixed(2)),
//     })),
//     subtotal: Number(subtotal.toFixed(2)),
//     item_discount_total: Number(item_discount_total.toFixed(2)),
//     bill_discount_total: Number(bill_discount_total.toFixed(2)),
//     coupon_discount_total: Number(coupon_discount_total.toFixed(2)),
//     membership_discount_total: Number(membership_discount_total.toFixed(2)),
//     total_before_redeem,
//     invoiceDiscounts,
//     appliedCouponRule,
//   };
// }

/**
 * Full createInvoice
 * - discounts + loyalty + inventory
 * - invoice_items + invoice_discounts + coupon_usage
 * - accounting (Sales, VAT, COGS, Inventory)
 */
export const createInvoice = async (req, res) => {

  const baseUrl = `${req.protocol}://${req.get("host")}`;
const businessName = req.user.full_name|| "SUPERMART";
  try {
    const tenant_id = req.user.tenant_id;
    const {
      items = [],
      payment_method = "cash",
      customer_id = null,
      redeem_points = 0,
      coupon_code = null,
    } = req.body;
    console.log(req.body);

    

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    // ======================================
// FETCH PRODUCT PRICES & TAX FROM DB
// ======================================
const productIds = items.map((i) => i.product_id);

const { data: productData, error: prodErr } = await supabase
  .from("products")
  .select("id, selling_price, tax")
  .in("id", productIds);

if (prodErr) {
  return res.status(500).json({ error: "Failed to fetch product info" });
}

const mergedItems = items.map((i) => {
  const p = productData.find((x) => x.id === i.product_id);
  if (!p) throw new Error(`Product not found: ${i.product_id}`);

  return {
    product_id: i.product_id,
    qty: i.qty,
    price: Number(p.selling_price),   // backend price override
    tax: Number(p.tax),       // backend tax override
  };
});


    const isLoyaltyCustomer = !!customer_id;
    let customer = null;
    if (isLoyaltyCustomer) {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, loyalty_points, lifetime_points, total_purchases, total_spent, membership_tier"
        )
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();
      if (error || !data)
        return res.status(404).json({ error: "Customer not found" });
      customer = data;
    }

    // 1) Apply discounts
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
// ====================================
// EMPLOYEE DISCOUNT (STAFF USER ONLY)
// ====================================
const { discount: employee_discount_total } = await calculateEmployeeDiscount({
  tenant_id,
  buyer_employee_id: req.body.employee_id || null,
  subtotal
});



    let total_amount =
  total_before_redeem - employee_discount_total;


    // 2) Coupon per-customer limit validation (if coupon and customer)
    if (
      appliedCouponRule &&
      isLoyaltyCustomer &&
      appliedCouponRule.per_customer_limit
    ) {
      const { data: usesByCustomer } = await supabase
        .from("coupon_usage")
        .select("id")
        .eq("coupon_id", appliedCouponRule.id)
        .eq("customer_id", customer_id);
      if (
        usesByCustomer &&
        usesByCustomer.length >= appliedCouponRule.per_customer_limit
      ) {
        return res
          .status(400)
          .json({ error: "Coupon usage limit reached for this customer" });
      }
    }

    // 3) Redeem points (if requested)
    let currentPoints = customer ? Number(customer.loyalty_points || 0) : 0;
    let lifetimePoints = customer ? Number(customer.lifetime_points || 0) : 0;

    if (isLoyaltyCustomer && redeem_points > 0) {
      if (redeem_points > currentPoints)
        return res.status(400).json({ error: "Not enough loyalty points" });

      total_amount = Number((total_amount - redeem_points).toFixed(2));
      currentPoints -= redeem_points;

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

    // 4) Create invoice with discount summary fields
    // 3.1) Generate per-tenant sales invoice sequence
    const { data: counter } = await supabase
      .from("tenant_counters")
      .select("sales_seq")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    let seq = 1;

    if (!counter) {
      // first invoice for this tenant
      await supabase
        .from("tenant_counters")
        .insert([{ tenant_id, sales_seq: 1 }]);
    } else {
      seq = counter.sales_seq + 1;
      await supabase
        .from("tenant_counters")
        .update({ sales_seq: seq })
        .eq("tenant_id", tenant_id);
    }

    // Generate invoice number format: INV-2025-0001
    const year = new Date().getFullYear();
    const invoice_number = `INV-${year}-${String(seq).padStart(4, "0")}`;

    // 4) Insert invoice WITHOUT invoice_number first
// ===========================
// 4) INSERT INVOICE (DEBUG LOGGING)
// ===========================


const insertPayload = {
  tenant_id,
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



const insertResult = await supabase
  .from("invoices")
  .insert([insertPayload])
  .select("*")
  .maybeSingle();



const invoice = insertResult.data;
const invoiceErr = insertResult.error;

if (invoiceErr) {
  console.error("❌ SUPABASE INSERT ERROR:", invoiceErr);
  return res.status(500).json({ error: invoiceErr.message });
}

if (!invoice) {
  console.error("❌ INSERT RETURNED NULL. MOST LIKELY CAUSE: Missing required column.");
  return res.status(500).json({ error: "Invoice insert returned null. Check console." });
}




      // === UPDATE EMPLOYEE DISCOUNT USAGE WITH INVOICE ID ===
if (employee_discount_total > 0) {
  await supabase
    .from("employee_discount_usage")
    .update({ invoice_id: invoice.id })
    .eq("employee_id", req.body.employee_id)
    .is("invoice_id", null);
}


    if (invoiceErr) throw invoiceErr;

    // 4.1) Now attach the invoice_number
    await supabase
      .from("invoices")
      .update({ invoice_number })
      .eq("id", invoice.id);


      const { data: updatedInvoice } = await supabase
  .from("invoices")
  .select("*")
  .eq("id", invoice.id)
  .single();

    // 5) Attach invoice_id to earlier redeem transactions
    if (isLoyaltyCustomer && redeem_points > 0) {
      await supabase
        .from("loyalty_transactions")
        .update({ invoice_id: invoice.id })
        .eq("customer_id", customer_id)
        .is("invoice_id", null);
    }

    // 6) Insert invoice_items with per-unit discount & net_price
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
    tax: it.tax,   // percent
    tax_amount: Number(it.taxAmount || 0),  // <-- NEW FIELD
    discount_amount: discountPerUnit,
    net_price: netUnit,
    total: lineTotal,
  };
});


    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItemsToInsert);
    if (itemsError) throw itemsError;

    // 7) Insert invoice-level discount rows (invoice_discounts)
    for (const invDisc of invoiceDiscounts) {
      await supabase.from("invoice_discounts").insert([
        {
          invoice_id: invoice.id,
          rule_id: invDisc.rule_id,
          amount: invDisc.amount,
          description: invDisc.description,
        },
      ]);
    }

    // 8) Record coupon usage (if coupon applied)
    if (appliedCouponRule) {
      await supabase.from("coupon_usage").insert([
        {
          customer_id: isLoyaltyCustomer ? customer_id : null,
          coupon_id: appliedCouponRule.id,
          invoice_id: invoice.id,
        },
      ]);
    }

    // 9) Update inventory
  // 9) Update inventory
const lowStockAlerts = [];
for (const it of itemsWithDiscounts) {
  const { data: invData } = await supabase
    .from("inventory")
    .select("id, quantity, reorder_level, product_id")
    .eq("tenant_id", tenant_id)
    .eq("product_id", it.product_id)
    .maybeSingle();

  // ❌ A sale should NEVER create inventory
  if (!invData) {
    throw new Error(
      `Inventory not found for product_id ${it.product_id}. 
       Add inventory via PURCHASE first.`
    );
  }

  const newQty = Math.max(0, Number(invData.quantity || 0) - it.qty);

  await supabase
    .from("inventory")
    .update({ quantity: newQty })
    .eq("id", invData.id)
    .eq("tenant_id", tenant_id);

  if (newQty <= Number(invData.reorder_level || 0)) {
    lowStockAlerts.push({
      product_id: it.product_id,
      newQty,
      reorder_level: invData.reorder_level,
    });
  }
}

    // 9.1) INSERT STOCK MOVEMENTS FOR SALES
    for (const it of itemsWithDiscounts) {
      await supabase.from("stock_movements").insert([
        {
          tenant_id,
          product_id: it.product_id,
          movement_type: "sale",
          reference_table: "invoices",
          reference_id: invoice.id,
          quantity: -Number(it.qty),
          created_at: new Date().toISOString(),
        },
      ]);
    }

    // 10) Earn loyalty points (after final total_amount)
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
        earn_points = Math.floor(
          (total_amount / currency_unit) * points_per_currency
        );
      } else {
        earn_points = Math.floor(total_amount / 100); // fallback
      }

      currentPoints += earn_points;
      lifetimePoints += earn_points;

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

    // 11) Update invoice final_amount and totals in DB
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

    // 12) ACCOUNTING: Daybook, Ledger, VAT, COGS

    // === FETCH COA ACCOUNTS FOR THIS TENANT ===
    const { data: coaAccounts, error: coaErr } = await supabase
      .from("coa")
      .select("id, name")
      .eq("tenant_id", tenant_id);

    if (coaErr || !coaAccounts || coaAccounts.length === 0) {
      throw new Error("COA accounts not found for this tenant");
    }

    function coaId(name) {
      const acc = coaAccounts.find(
        (a) => a.name.toLowerCase() === name.toLowerCase()
      );
      if (!acc) throw new Error(`COA account not found: ${name}`);
      return acc.id;
    }

    try {
      const saleAmount = total_amount;
      const saleDescription = `Invoice #${
        invoice.invoice_number || invoice.id
      }`;

      // Daybook entry (Sale)
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

      // Tax total from items (after item-level discounts)
      const totalTax = itemsWithDiscounts.reduce(
        (s, it) => s + Number(it.taxAmount || 0),
        0
      );
      const netSales = Math.max(0, saleAmount - totalTax);

      // Ledger: Debit CASH / RECEIVABLE
      const paymentAccountType =
        payment_method === "credit" ? "Accounts Receivable" : "cash";

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

      // Ledger: Credit SALES
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

      // Ledger: Credit VAT PAYABLE
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

      // JOURNAL ENTRIES

      // CASE 1: CASH SALE
      if (payment_method !== "credit") {
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
      }

      // CASE 2: CREDIT SALE
      if (payment_method === "credit") {
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

      // DISCOUNTS (Expense)
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

      // EMPLOYEE DISCOUNT (Expense)
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

      // 12.1) COGS + Inventory accounting (using cost_price)
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

      // VAT REPORT (monthly, period = YYYY-MM)
      const now = invoice.created_at
        ? new Date(invoice.created_at)
        : new Date();
      const period = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;

      const { data: existingVat, error: vatErr } = await supabase
        .from("vat_reports")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("period", period)
        .maybeSingle();

      if (vatErr) {
        console.error("VAT fetch error:", vatErr);
      } else if (existingVat) {
        const newTotalSales =
          Number(existingVat.total_sales || 0) + Number(saleAmount || 0);
        const newSalesVat =
          Number(existingVat.sales_vat || 0) + Number(totalTax || 0);
        const newPurchaseVat = Number(existingVat.purchase_vat || 0);
        const newVatPayable = newSalesVat - newPurchaseVat;

        const { error: updateVatErr } = await supabase
          .from("vat_reports")
          .update({
            total_sales: newTotalSales,
            sales_vat: newSalesVat,
            vat_payable: newVatPayable,
          })
          .eq("id", existingVat.id);

        if (updateVatErr) {
          console.error("VAT update error:", updateVatErr);
        }
      } else {
        const { error: insertVatErr } = await supabase
          .from("vat_reports")
          .insert([
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
        if (insertVatErr) {
          console.error("VAT insert error:", insertVatErr);
        }
      }
    } catch (accErr) {
      console.error("Accounting entries failed:", accErr);
      // we don't fail the invoice if accounting tables fail
    }

    // 13) Fetch product names and merge into items (for response)
 const productIds2 = [
  ...new Set(invoiceItemsToInsert.map((i) => i.product_id)),
];

const { data: productNames, error: productNameErr } = await supabase
  .from("products")
  .select("id, name")
  .in("id", productIds2);

if (productNameErr) throw productNameErr;

const productMap = {};
(productNames || []).forEach((p) => {
  productMap[p.id] = p.name;
});


    const itemsWithNames = invoiceItemsToInsert.map((it) => ({
      ...it,
      name: productMap[it.product_id] || "Unknown",
    }));

    // -------------------------------------------
// 14) GENERATE RECEIPT PDF (BACKEND VERSION)
// -------------------------------------------
const pdfUrl = await generatePDF({
  invoiceNumber: invoice_number,
  items: itemsWithNames,
  total: total_amount,
  payment_method,
  subtotal,
  baseUrl,
  businessName
});
res.setHeader("Content-Type", "application/pdf");
res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoice_number}.pdf`);
return res.send(pdfUrl);

    // Final response
  return res.status(201).json({
  message: "Invoice created successfully",
  invoice: {
    ...invoice,
    ...updatedInvoice,
    subtotal,
    final_amount: total_amount,
    pdf_url: pdfUrl
  },
  items: itemsWithNames,
  lowStockAlerts,
  loyalty: isLoyaltyCustomer
    ? {
        earned: earn_points,
        redeemed: redeem_points,
        final_balance: currentPoints,
      }
    : null,
});

  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

/**
 * generatePDF (unchanged)
 */
// export const generatePDF = async (req, res) => {
//   try {
//     const { invoiceNumber, items, subtotal, total, payment_method } = req.body;

//     const invoicesDir = path.join(process.cwd(), "invoices");
//     if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

//     const filePath = path.join(invoicesDir, `invoice-${invoiceNumber}.pdf`);

//     // 80mm thermal = approx 226 pts width, height variable
//     const doc = new PDFDocument({
//       size: [226, 600],
//       margin: 10,
//     });

//     const stream = fs.createWriteStream(filePath);
//     doc.pipe(stream);

//     let y = 10;

//     const center = (text, size = 10, font = "Courier") => {
//       doc.font(font).fontSize(size);
//       doc.text(text, 0, y, { width: 226, align: "center" });
//       y += size + 2;
//     };

//     const line = () => {
//       doc
//         .font("Courier")
//         .fontSize(9)
//         .text("----------------------------------------", 0, y, {
//           width: 226,
//           align: "center",
//         });
//       y += 12;
//     };

//     const starLine = () => {
//       doc
//         .font("Courier")
//         .fontSize(10)
//         .text("********************************", 0, y, {
//           width: 226,
//           align: "center",
//         });
//       y += 14;
//     };

//     // ⭐ Top Stars
//     starLine();

//     // ⭐ Store Name
//     center("SUPERMART", 16);

//     // ⭐ Bottom Stars
//     starLine();

//     // Invoice details
//     doc.font("Courier").fontSize(9).text(`Invoice No: ${invoiceNumber}`, 10, y);
//     y += 12;

//     doc
//       .font("Courier")
//       .fontSize(9)
//       .text(`Date: ${new Date().toLocaleString()}`, 10, y);
//     y += 14;

//     // Divider
//     line();

//     // Items
//     doc.font("Courier").fontSize(10);

//     items.forEach((item) => {
//       const name = `${item.qty}x ${item.name}`;
//       const price = `AED ${Number(item.total).toFixed(2)}`;

//       doc.text(name, 10, y);
//       doc.text(price, -10, y, { align: "right" });
//       y += 14;
//     });

//     // Divider
//     y += 2;
//     line();

//     // TOTAL bold
//     doc.font("Courier-Bold").fontSize(11);
//     doc.text("TOTAL:", 10, y);
//     doc.text(`AED ${total.toFixed(2)}`, -10, y, { align: "right" });
//     y += 16;

//     // Payment Method
//     doc.font("Courier").fontSize(10);
//     doc.text("Payment Method:", 10, y);
//     doc.text(payment_method.toUpperCase(), -10, y, { align: "right" });
//     y += 14;

//     // Divider
//     line();

//     // Thank you
//     doc.font("Courier-Bold").fontSize(10);
//     center("********* THANK YOU! *********", 10);

//     y += 10;

//     // Simple barcode mimic
//     const barStartX = 40;
//     const barWidth = 100;

//     for (let i = 0; i < 40; i++) {
//       const x = barStartX + i * 2.2;
//       const lineW = Math.random() > 0.5 ? 1.2 : 0.6;

//       doc
//         .moveTo(x, y)
//         .lineTo(x, y + 25)
//         .lineWidth(lineW)
//         .stroke();
//     }

//     doc.end();

//     stream.on("finish", () => {
//       res.status(200).json({
//         message: "Invoice PDF generated",
//         pdf_url: `http://localhost:5000/invoices/invoice-${invoiceNumber}.pdf`,
//       });
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to generate invoice PDF" });
//   }
// };
