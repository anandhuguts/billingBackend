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

  // 6) Monthly limit logic (COUNT-BASED: number of times, not total amount)
  if (rule.monthly_limit) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    // ✅ COUNT uses (not sum amounts) - Only count properly linked invoices
    const { data: used, error: usageErr } = await supabase
      .from("employee_discount_usage")
      .select("id", { count: "exact", head: false })
      .eq("tenant_id", tenant_id)
      .eq("employee_id", buyer_employee_id)
      .not("invoice_id", "is", null)  // Only count linked records
      .gte("used_at", start)
      .lt("used_at", next);

    if (usageErr) {
      console.error("Failed to check employee discount usage:", usageErr);
      throw usageErr;
    }

    const timesUsed = used?.length || 0;
    const remainingUses = rule.monthly_limit - timesUsed;

    // If no remaining uses, no discount
    if (remainingUses <= 0) {
      discount = 0;
    }
    // Otherwise, discount is available (full amount based on percent/max)
  }

  // 7) Create temporary record and RETURN its ID (invoice_id attached later)
  let usageRecordId = null;

  if (discount > 0) {
    const { data: usageRecord, error: insertErr } = await supabase
      .from("employee_discount_usage")
      .insert([
        {
          tenant_id,
          employee_id: buyer_employee_id,
          invoice_id: null,
          discount_amount: discount,
        },
      ])
      .select("id")
      .single();

    if (insertErr) {
      console.error("❌ Failed to create employee discount usage record:", insertErr);
      throw insertErr;
    }

    usageRecordId = usageRecord?.id;
  }

  return {
    discount,
    usageRecordId  // ✅ Return the ID so we can update THIS specific record
  };
}
