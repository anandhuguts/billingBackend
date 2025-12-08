import { supabase } from "../supabase/supabaseClient.js";

export async function applyDiscounts({
  items,
  tenant_id,
  customer = null,
  couponCode = null,
}) {
  // fetch active discount rules for tenant
  const { data: rules = [], error: rulesErr } = await supabase
    .from("discount_rules")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true);

  if (rulesErr) throw rulesErr;

  const itemRules = rules.filter((r) => r.type === "item");
  const billRules = rules.filter((r) => r.type === "bill");
  const couponRules = rules.filter((r) => r.type === "coupon");
  const tierRules = rules.filter((r) => r.type === "tier");

  // normalize items
  // price = inclusive selling price per unit
  const workingItems = items.map((it) => {
    const unitGross = Number(it.price || 0); // inclusive per unit
    const qty = Number(it.qty || 0);
    const taxPercent = Number(it.tax || 0);

    const divisor = 1 + taxPercent / 100;
    let unitBase = unitGross;
    let unitTax = 0;

    if (taxPercent > 0) {
      unitBase = unitGross / divisor;
      unitTax = unitGross - unitBase;
    }

    const lineGross = unitGross * qty; // inclusive total (before item discount)
    const lineBase = unitBase * qty;
    const lineTax = unitTax * qty;

    return {
      ...it,
      qty,
      unitGross,
      taxPercent,
      unitBase,
      unitTax,
      lineGross,
      lineBase,
      lineTax,
      lineDiscount: 0, // total discount for the line (not per-unit)
      perUnitDiscount: 0,
      netUnitGross: unitGross,
      netLineGross: lineGross,
      netLineBase: lineBase,
      netLineTax: lineTax,
    };
  });

  const invoiceDiscounts = [];

  // -----------------------------------------
  // 1) ITEM-LEVEL DISCOUNTS (on inclusive line total)

   const subtotal = workingItems.reduce((s, it) => s + it.lineGross, 0);
  // -----------------------------------------
for (const rule of itemRules) {
  for (const it of workingItems) {

    // Apply only to matching product
    if (
      rule.product_id &&
      Number(rule.product_id) === Number(it.product_id)
    ) {
      // NEW: Check min bill amount BEFORE applying discount
      if (
        rule.min_bill_amount &&
        subtotal < Number(rule.min_bill_amount)
      ) {
        continue; // Do not apply discount
      }

      let extraLineDiscount = 0;

      if (Number(rule.discount_percent || 0) > 0) {
        extraLineDiscount =
          (it.lineGross * Number(rule.discount_percent)) / 100;
      } else if (Number(rule.discount_amount || 0) > 0) {
        extraLineDiscount = Number(rule.discount_amount) * it.qty;
      }

      const remaining = it.lineGross - it.lineDiscount;
      extraLineDiscount = Math.max(0, Math.min(extraLineDiscount, remaining));

      it.lineDiscount += extraLineDiscount;
    }
  }
}


  // recompute per-unit and net values AFTER item discounts
  for (const it of workingItems) {
    if (it.qty > 0) {
      it.perUnitDiscount = it.lineDiscount / it.qty;
      it.netUnitGross = it.unitGross - it.perUnitDiscount;
      it.netLineGross = it.netUnitGross * it.qty;

      const divisor = 1 + it.taxPercent / 100;
      if (it.taxPercent > 0) {
        it.netLineBase = it.netLineGross / divisor;
        it.netLineTax = it.netLineGross - it.netLineBase;
      } else {
        it.netLineBase = it.netLineGross;
        it.netLineTax = 0;
      }
    } else {
      it.perUnitDiscount = 0;
      it.netUnitGross = it.unitGross;
      it.netLineGross = it.lineGross;
      it.netLineBase = it.lineBase;
      it.netLineTax = it.lineTax;
    }
  }

 
  const item_discount_total = workingItems.reduce(
    (s, it) => s + it.lineDiscount,
    0
  );
  let total_after_item = Number((subtotal - item_discount_total).toFixed(2));

  // -----------------------------------------
  // 2) BILL-LEVEL DISCOUNT
  // -----------------------------------------
  let bill_discount_total = 0;

  for (const rule of billRules) {
    if (
      rule.min_bill_amount &&
      total_after_item < Number(rule.min_bill_amount)
    ) {
      continue;
    }

    let amt = 0;

    if (Number(rule.discount_percent || 0) > 0) {
      amt = (total_after_item * Number(rule.discount_percent)) / 100;
    } else if (Number(rule.discount_amount || 0) > 0) {
      amt = Number(rule.discount_amount);
    }

    amt = Math.max(0, Math.min(amt, total_after_item - bill_discount_total));

    if (amt > 0) {
      bill_discount_total = Number((bill_discount_total + amt).toFixed(2));
      invoiceDiscounts.push({
        rule_id: rule.id,
        amount: Number(amt.toFixed(2)),
        description: `Bill discount rule ${rule.id}`,
      });
    }
  }

  let total_after_bill = Number(
    (total_after_item - bill_discount_total).toFixed(2)
  );

  // -----------------------------------------
  // 3) COUPON DISCOUNT
  // -----------------------------------------
  let coupon_discount_total = 0;
  let appliedCouponRule = null;

  if (couponCode) {
    const rule = couponRules.find(
      (r) =>
        r.code &&
        String(r.code).toLowerCase() === String(couponCode).toLowerCase()
    );

    if (!rule) throw new Error("Invalid coupon code");

    if (Number(rule.min_bill_amount || 0) > total_after_bill) {
      throw new Error("Coupon minimum bill not satisfied");
    }

    if (rule.max_uses) {
      const { data: uses } = await supabase
        .from("coupon_usage")
        .select("id")
        .eq("coupon_id", rule.id);

      if (uses && uses.length >= rule.max_uses)
        throw new Error("Coupon usage limit reached");
    }

    if (Number(rule.discount_percent || 0) > 0) {
      coupon_discount_total = Number(
        ((total_after_bill * Number(rule.discount_percent)) / 100).toFixed(2)
      );
    } else if (Number(rule.discount_amount || 0) > 0) {
      coupon_discount_total = Math.min(
        Number(rule.discount_amount),
        total_after_bill
      );
    }

    if (coupon_discount_total > 0) {
      appliedCouponRule = rule;
      invoiceDiscounts.push({
        rule_id: rule.id,
        amount: coupon_discount_total,
        description: `Coupon ${rule.code}`,
      });
    }
  }

  let total_after_coupon = Number(
    (total_after_bill - coupon_discount_total).toFixed(2)
  );

  // -----------------------------------------
  // 4) MEMBERSHIP TIER DISCOUNT
  // -----------------------------------------
  let membership_discount_total = 0;

  if (customer && customer.membership_tier) {
    const tierRule = tierRules.find(
      (tr) =>
        tr.tier &&
        String(tr.tier).toLowerCase() ===
          String(customer.membership_tier).toLowerCase()
    );

    if (tierRule) {
      if (Number(tierRule.discount_percent || 0) > 0) {
        membership_discount_total = Number(
          (
            (total_after_coupon * Number(tierRule.discount_percent)) /
            100
          ).toFixed(2)
        );
      } else if (Number(tierRule.discount_amount || 0) > 0) {
        membership_discount_total = Math.min(
          Number(tierRule.discount_amount),
          total_after_coupon
        );
      }

      if (membership_discount_total > 0) {
        invoiceDiscounts.push({
          rule_id: tierRule.id,
          amount: membership_discount_total,
          description: `Membership ${tierRule.tier} discount`,
        });
      }
    }
  }

  const total_after_membership = Number(
    (total_after_coupon - membership_discount_total).toFixed(2)
  );
  const total_before_redeem = Number(total_after_membership.toFixed(2));

  // -----------------------------------------
  // RETURN FINAL STRUCTURE
  // discount_amount = per-unit discount
  // net_price = per-unit net inclusive price
  // taxAmount = tax AFTER item discount
  // -----------------------------------------
  return {
    items: workingItems.map((it) => ({
      product_id: it.product_id,
      qty: it.qty,
      price: Number(it.unitGross.toFixed(2)), // inclusive per unit
      tax: it.taxPercent,
      lineBase: Number(it.netLineBase.toFixed(2)),
      taxAmount: Number(it.netLineTax.toFixed(2)),
      baseWithTax: Number(it.netLineGross.toFixed(2)),
      discount_amount: Number((it.perUnitDiscount || 0).toFixed(2)),
      net_price: Number((it.netUnitGross || it.unitGross).toFixed(2)),
    })),
    subtotal: Number(subtotal.toFixed(2)),
    item_discount_total: Number(item_discount_total.toFixed(2)),
    bill_discount_total: Number(bill_discount_total.toFixed(2)),
    coupon_discount_total: Number(coupon_discount_total.toFixed(2)),
    membership_discount_total: Number(membership_discount_total.toFixed(2)),
    total_before_redeem,
    invoiceDiscounts,
    appliedCouponRule,
  };
}