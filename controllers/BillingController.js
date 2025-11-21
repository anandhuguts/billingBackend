// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * Discount engine: applyDiscounts
 * Returns object with items (with discount_amount & net_price), totals and invoiceDiscounts list.
 */
export async function applyDiscounts({ items, tenant_id, customer = null, couponCode = null }) {
  // fetch active discount rules for tenant
  const { data: rules = [], error: rulesErr } = await supabase
    .from("discount_rules")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true);

  if (rulesErr) throw rulesErr;

  const itemRules = rules.filter(r => r.type === "item");
  const billRules = rules.filter(r => r.type === "bill");
  const couponRules = rules.filter(r => r.type === "coupon");
  const tierRules = rules.filter(r => r.type === "tier");

  // normalize items and compute base/tax
  const workingItems = items.map(it => {
    const price = parseFloat(it.price || 0);
    const qty = Number(it.qty || 0);
    const taxPercent = parseFloat(it.tax || 0);
    const lineBase = price * qty;
    const taxAmount = parseFloat(((lineBase * taxPercent) / 100).toFixed(4));
    const baseWithTax = parseFloat((lineBase + taxAmount).toFixed(4));
    return {
      ...it,
      price,
      qty,
      taxPercent,
      lineBase,
      taxAmount,
      baseWithTax,
      discount_amount: 0,
      net_price: baseWithTax
    };
  });

  const invoiceDiscounts = [];

  // 1) Apply item-level discounts (percent or flat per unit)
  for (const rule of itemRules) {
    for (const it of workingItems) {
      if (rule.product_id && Number(rule.product_id) === Number(it.product_id)) {
        let discount = 0;
        if (parseFloat(rule.discount_percent || 0) > 0) {
          // apply percent on line base + tax
          discount = (it.baseWithTax * parseFloat(rule.discount_percent) / 100);
        } else if (parseFloat(rule.discount_amount || 0) > 0) {
          // flat per unit * qty
          discount = parseFloat(rule.discount_amount) * it.qty;
        }
        // cap discount to not exceed baseWithTax
        discount = Math.max(0, Math.min(discount, it.baseWithTax));
        it.discount_amount = parseFloat((it.discount_amount + discount).toFixed(2));
        it.net_price = parseFloat((it.baseWithTax - it.discount_amount).toFixed(2));
      }
    }
  }

  // totals after item discounts
  const subtotal = workingItems.reduce((s, it) => s + it.baseWithTax, 0);
  const item_discount_total = workingItems.reduce((s, it) => s + (it.discount_amount || 0), 0);
  let total_after_item = parseFloat((subtotal - item_discount_total).toFixed(2));

  // 2) Bill-level discounts (can be multiple; percent or flat)
  let bill_discount_total = 0;
  for (const rule of billRules) {
    let amt = 0;
    if (parseFloat(rule.discount_percent || 0) > 0) {
      amt = (total_after_item * parseFloat(rule.discount_percent) / 100);
    } else if (parseFloat(rule.discount_amount || 0) > 0) {
      amt = parseFloat(rule.discount_amount);
    }
    amt = Math.max(0, Math.min(amt, total_after_item - bill_discount_total));
    if (amt > 0) {
      bill_discount_total = parseFloat((bill_discount_total + amt).toFixed(2));
      invoiceDiscounts.push({
        rule_id: rule.id,
        amount: parseFloat(amt.toFixed(2)),
        description: `Bill discount rule ${rule.id}`
      });
    }
  }

  let total_after_bill = parseFloat((total_after_item - bill_discount_total).toFixed(2));

  // 3) Coupon (single) validation & apply
  let coupon_discount_total = 0;
  let appliedCouponRule = null;
  if (couponCode) {
    const rule = couponRules.find(r => r.code && String(r.code).toLowerCase() === String(couponCode).toLowerCase());
    if (!rule) throw new Error("Invalid coupon code");

    // min bill validation
    if (parseFloat(rule.min_bill_amount || 0) > total_after_bill) {
      throw new Error("Coupon minimum bill not satisfied");
    }

    // max uses check
    if (rule.max_uses) {
      const { data: uses } = await supabase.from("coupon_usage").select("id").eq("coupon_id", rule.id);
      if (uses && uses.length >= rule.max_uses) throw new Error("Coupon usage limit reached");
    }

    // per-customer limit check will be applied later in controller where we know customer

    // apply coupon
    if (parseFloat(rule.discount_percent || 0) > 0) {
      coupon_discount_total = parseFloat(((total_after_bill * parseFloat(rule.discount_percent) / 100)).toFixed(2));
    } else if (parseFloat(rule.discount_amount || 0) > 0) {
      coupon_discount_total = Math.min(parseFloat(rule.discount_amount), total_after_bill);
    }

    if (coupon_discount_total > 0) {
      appliedCouponRule = rule;
      invoiceDiscounts.push({
        rule_id: rule.id,
        amount: coupon_discount_total,
        description: `Coupon ${rule.code}`
      });
    }
  }

  let total_after_coupon = parseFloat((total_after_bill - coupon_discount_total).toFixed(2));

  // 4) Membership tier discount
  let membership_discount_total = 0;
  if (customer && customer.membership_tier) {
    const tierRule = tierRules.find(tr => tr.tier && String(tr.tier).toLowerCase() === String(customer.membership_tier).toLowerCase());
    if (tierRule) {
      if (parseFloat(tierRule.discount_percent || 0) > 0) {
        membership_discount_total = parseFloat(((total_after_coupon * parseFloat(tierRule.discount_percent) / 100)).toFixed(2));
      } else if (parseFloat(tierRule.discount_amount || 0) > 0) {
        membership_discount_total = Math.min(parseFloat(tierRule.discount_amount), total_after_coupon);
      }
      if (membership_discount_total > 0) {
        invoiceDiscounts.push({
          rule_id: tierRule.id,
          amount: membership_discount_total,
          description: `Membership ${tierRule.tier} discount`
        });
      }
    }
  }

  const total_after_membership = parseFloat((total_after_coupon - membership_discount_total).toFixed(2));

  // final totals pre-redeem
  const total_before_redeem = parseFloat(total_after_membership.toFixed(2));

  return {
    items: workingItems.map(it => ({
      product_id: it.product_id,
      qty: it.qty,
      price: it.price,
      tax: it.taxPercent,
      lineBase: it.lineBase,
      taxAmount: it.taxAmount,
      baseWithTax: it.baseWithTax,
      discount_amount: parseFloat((it.discount_amount || 0).toFixed(2)),
      net_price: parseFloat((it.net_price || it.baseWithTax).toFixed(2))
    })),
    subtotal: parseFloat(subtotal.toFixed(2)),
    item_discount_total: parseFloat(item_discount_total.toFixed(2)),
    bill_discount_total: parseFloat(bill_discount_total.toFixed(2)),
    coupon_discount_total: parseFloat(coupon_discount_total.toFixed(2)),
    membership_discount_total: parseFloat(membership_discount_total.toFixed(2)),
    total_before_redeem,
    invoiceDiscounts,
    appliedCouponRule
  };
}

/**
 * Full createInvoice (discounts + loyalty + inventory + invoice_items + invoice_discounts + coupon_usage)
 */
export const createInvoice = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { items = [], payment_method = "cash", customer_id = null, redeem_points = 0, coupon_code = null } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: "No items provided" });

    const isLoyaltyCustomer = !!customer_id;
    let customer = null;
    if (isLoyaltyCustomer) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, loyalty_points, lifetime_points, total_purchases, total_spent, membership_tier")
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();
      if (error || !data) return res.status(404).json({ error: "Customer not found" });
      customer = data;
    }

    // 1) Apply discounts
    let discountResult;
    try {
      discountResult = await applyDiscounts({ items, tenant_id, customer, couponCode: coupon_code });
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
      appliedCouponRule
    } = discountResult;

    let total_amount = total_before_redeem;

    // 2) Coupon per-customer limit validation (if coupon and customer)
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

    // 3) Redeem points (if requested)
    let currentPoints = customer ? Number(customer.loyalty_points || 0) : 0;
    let lifetimePoints = customer ? Number(customer.lifetime_points || 0) : 0;

    if (isLoyaltyCustomer && redeem_points > 0) {
      if (redeem_points > currentPoints) return res.status(400).json({ error: "Not enough loyalty points" });
      total_amount = parseFloat((total_amount - redeem_points).toFixed(2));
      currentPoints -= redeem_points;

      // insert redeem transaction with invoice_id = null (attach later)
      await supabase.from("loyalty_transactions").insert([{
        customer_id,
        invoice_id: null,
        transaction_type: "redeem",
        points: -redeem_points,
        balance_after: currentPoints,
        description: `Redeemed ${redeem_points} points`
      }]);
    }

    // ensure total_amount never negative
    if (total_amount < 0) total_amount = 0;

    // 4) Create invoice with discount summary fields
    const { data: invoice, error: invoiceErr } = await supabase
      .from("invoices")
      .insert([{
        tenant_id,
        customer_id: isLoyaltyCustomer ? customer_id : null,
        total_amount,
        payment_method,
        item_discount_total,
        bill_discount_total,
        coupon_discount_total,
        membership_discount_total,
        final_amount: total_amount
      }])
      .select()
      .single();

    if (invoiceErr) throw invoiceErr;

    // 5) Attach invoice_id to earlier redeem transactions
    if (isLoyaltyCustomer && redeem_points > 0) {
      await supabase
        .from("loyalty_transactions")
        .update({ invoice_id: invoice.id })
        .eq("customer_id", customer_id)
        .is("invoice_id", null);
    }

    // 6) Insert invoice_items with per-line discount & net_price
const invoiceItemsToInsert = itemsWithDiscounts.map(it => ({
  tenant_id,
  invoice_id: invoice.id,
  product_id: it.product_id,
  quantity: it.qty,
  price: it.price,
  tax: it.tax,
  discount_amount: it.discount_amount,   // REQUIRED for net_price generation
  total: it.net_price                    // OR use baseWithTax if you prefer
  // DO NOT include net_price (Postgres will auto-generate it)
}));


    const { error: itemsError } = await supabase.from("invoice_items").insert(invoiceItemsToInsert);
    if (itemsError) throw itemsError;

    // 7) Insert invoice-level discount rows (invoice_discounts)
    for (const invDisc of invoiceDiscounts) {
      await supabase.from("invoice_discounts").insert([{
        invoice_id: invoice.id,
        rule_id: invDisc.rule_id,
        amount: invDisc.amount,
        description: invDisc.description
      }]);
    }

    // 8) Record coupon usage (if coupon applied)
    if (appliedCouponRule) {
      await supabase.from("coupon_usage").insert([{
        customer_id: isLoyaltyCustomer ? customer_id : null,
        coupon_id: appliedCouponRule.id,
        invoice_id: invoice.id
      }]);
    }

    // 9) Update inventory
    const lowStockAlerts = [];
    for (const it of itemsWithDiscounts) {
      const { data: invData } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", it.product_id)
        .single();

      if (!invData) {
        await supabase.from("inventory").insert([{
          tenant_id,
          product_id: it.product_id,
          quantity: 0,
          reorder_level: 5,
          max_stock: 100
        }]);
        continue;
      }

      const newQty = Math.max(0, Number(invData.quantity || 0) - it.qty);
      await supabase.from("inventory").update({ quantity: newQty }).eq("id", invData.id).eq("tenant_id", tenant_id);
      if (newQty <= Number(invData.reorder_level || 0)) {
        lowStockAlerts.push({ product_id: it.product_id, newQty, reorder_level: invData.reorder_level });
      }
    }

    // 10) Earn loyalty points (after final total_amount)
    let earn_points = 0;
    if (isLoyaltyCustomer) {
      // fetch loyalty earning rule if exists
    const { data: earnRule } = await supabase
  .from("loyalty_rules")
  .select("*")
  .eq("tenant_id", tenant_id)
  .eq("is_active", true)
  .maybeSingle();


      if (earnRule && earnRule.points_per_currency && earnRule.currency_unit) {
        const currency_unit = parseFloat(earnRule.currency_unit || 100);
        const points_per_currency = parseFloat(earnRule.points_per_currency || 1);
        earn_points = Math.floor((total_amount / currency_unit) * points_per_currency);
      } else {
        earn_points = Math.floor(total_amount / 100); // fallback
      }

      currentPoints += earn_points;
      lifetimePoints += earn_points;

      // update customer summary
      await supabase.from("customers").update({
        loyalty_points: currentPoints,
        lifetime_points: lifetimePoints,
        last_purchase_at: new Date(),
        total_purchases: (customer.total_purchases || 0) + 1,
        total_spent: (Number(customer.total_spent || 0) + total_amount)
      }).eq("id", customer_id);

      // insert loyalty earn transaction
      await supabase.from("loyalty_transactions").insert([{
        customer_id,
        invoice_id: invoice.id,
        transaction_type: "earn",
        points: earn_points,
        balance_after: currentPoints,
        description: `Earned ${earn_points} points for invoice #${invoice.id}`
      }]);
    }

    // 11) Update invoice final_amount and totals (in DB) in case any rounding/changes needed
    await supabase.from("invoices").update({
      item_discount_total,
      bill_discount_total,
      coupon_discount_total,
      membership_discount_total,
      final_amount: total_amount
    }).eq("id", invoice.id);

    // Final response
  // 12) Fetch product names and merge into items
const productIds = [...new Set(invoiceItemsToInsert.map(i => i.product_id))];

const { data: productData, error: prodErr } = await supabase
  .from("products")
  .select("id, name")
  .in("id", productIds);

if (prodErr) throw prodErr;

const productMap = {};
productData.forEach(p => {
  productMap[p.id] = p.name;
});

const itemsWithNames = invoiceItemsToInsert.map(it => ({
  ...it,
  name: productMap[it.product_id] || "Unknown"
}));

// 13) Return final response
return res.status(201).json({
  message: "Invoice created successfully",
  invoice,
  items: itemsWithNames,
  lowStockAlerts,
  loyalty: isLoyaltyCustomer
    ? { earned: earn_points, redeemed: redeem_points, final_balance: currentPoints }
    : null
});


  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};


/**
 * generatePDF (unchanged)
 */
export const generatePDF = async (req, res) => {
  try {
    const { invoiceNumber, items, subtotal, total, payment_method } = req.body;

    const invoicesDir = path.join(process.cwd(), "invoices");
    if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

    const filePath = path.join(invoicesDir, `invoice-${invoiceNumber}.pdf`);
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("SUPERMART", { align: "center" }).moveDown(0.5);
    doc.fontSize(10).text(`Invoice No: ${invoiceNumber}`);
    doc.text(`Date: ${new Date().toLocaleString()}`);
    doc.moveDown(1);
    doc.text("========================================", { align: "center" });

    items.forEach((item) => {
      doc.text(`${item.qty}x ${item.name} - AED ${item.total.toFixed(2)}`);
    });

    doc.moveDown(1);
    doc.text("========================================", { align: "center" });

    doc.text(`Subtotal: AED ${subtotal.toFixed(2)}`);
    doc.text(`Payment Method: ${payment_method}`);
    doc.fontSize(14).text(`Total: AED ${total.toFixed(2)}`, { align: "right" });

    doc.moveDown(1.5);
    doc.fontSize(10).text("Thank you for shopping with us!", { align: "center" });

    doc.end();

    stream.on("finish", () => {
      res.status(200).json({
        message: "Invoice PDF generated",
        pdf_url: `http://localhost:5000/invoices/invoice-${invoiceNumber}.pdf`,
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate invoice PDF" });
  }
};
