import { supabase } from "../supabase/supabaseClient.js";

export async function calculateEmployeeDiscount({
  tenant_id,
  buyer_employee_id,
  logged_in_user,
  subtotal,
  invoice_id
}) {
  // 1) Must provide employee_id in body
  if (!buyer_employee_id) return { discount: 0 };

  // 2) Only the same employee can bill themselves
  if (buyer_employee_id !== logged_in_user.id) return { discount: 0 };

  // 3) Must be staff role
  if (logged_in_user.role !== "staff") return { discount: 0 };

  // 4) Get employee discount rule
  const { data: rules } = await supabase
    .from("employee_discount_rules")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .limit(1);

  if (!rules?.length) return { discount: 0 };
  const rule = rules[0];

  // Base discount
  let discount = (subtotal * Number(rule.discount_percent || 0)) / 100;

  // Per bill max
  if (rule.max_discount_amount && discount > rule.max_discount_amount) {
    discount = rule.max_discount_amount;
  }

  // Monthly limit check
  if (rule.monthly_limit) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    const { data: used } = await supabase
      .from("employee_discount_usage")
      .select("discount_amount")
      .eq("tenant_id", tenant_id)
      .eq("employee_id", buyer_employee_id)
      .gte("used_at", start)
      .lt("used_at", next);

    const usedAmt = used?.reduce((t, r) => t + Number(r.discount_amount), 0) || 0;
    const remaining = rule.monthly_limit - usedAmt;

    if (remaining <= 0) discount = 0;
    else if (discount > remaining) discount = remaining;
  }

  // Insert TEMP record (invoice_id assigned later)
 if (discount > 0 && buyer_employee_id === logged_in_user.id) {
    await supabase.from("employee_discount_usage").insert([
      {
        tenant_id,
        employee_id: buyer_employee_id,
        invoice_id,
        discount_amount: discount,
      },
    ]);
  }

  return { discount };
}