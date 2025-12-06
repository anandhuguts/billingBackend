import { supabase } from "../supabase/supabaseClient.js";

export async function calculateEmployeeDiscount({
  tenant_id,
  buyer_employee_id,
  subtotal,
}) {
  // 1) Must provide employee_id
  if (!buyer_employee_id) return { discount: 0 };

  // 2) Check if employee exists in employees table
  const { data: employee, error: empErr } = await supabase
    .from("employees")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("id", buyer_employee_id)
    .maybeSingle();

  // If no employee found → no discount
  if (empErr || !employee) {
  throw new Error("Invalid employee ID");
}

  // 3) Fetch active employee discount rule
  const { data: rules } = await supabase
    .from("employee_discount_rules")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .limit(1);

  if (!rules?.length) return { discount: 0 };
  const rule = rules[0];

  // 4) Base discount amount
  let discount = (subtotal * Number(rule.discount_percent || 0)) / 100;

  // 5) Per-bill max cap
  if (rule.max_discount_amount && discount > rule.max_discount_amount) {
    discount = rule.max_discount_amount;
  }

  // 6) Monthly limit logic
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

    const usedAmt =
      used?.reduce((t, r) => t + Number(r.discount_amount || 0), 0) || 0;

    const remaining = rule.monthly_limit - usedAmt;

    if (remaining <= 0) discount = 0;
    else if (discount > remaining) discount = remaining;
  }

  // 7) TEMP record (invoice_id attached later)
  if (discount > 0) {
    await supabase.from("employee_discount_usage").insert([
      {
        tenant_id,
        employee_id: buyer_employee_id,
        invoice_id: null,
        discount_amount: discount,
      },
    ]);
  }

  return { discount };
}
