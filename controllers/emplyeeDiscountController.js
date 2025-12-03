// controllers/emplyeeDiscountController.js
import { supabase } from "../supabase/supabaseClient.js";

export const EmployeeDiscountController = {
  async setRule(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { discount_percent, max_discount_amount, monthly_limit } = req.body;

      const { data, error } = await supabase
        .from("employee_discount_rules")
        .upsert(
          {
            tenant_id,
            discount_percent,
            max_discount_amount,
            monthly_limit,
            is_active: true,
          },
          { onConflict: "tenant_id" }
        )
        .select();

      if (error) throw error;

      return res.json({ success: true, data: data[0] });
    } catch (err) {
      console.error("setRule error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  async getRule(req, res) {
    try {
      const tenant_id = req.user.tenant_id;

      const { data, error } = await supabase
        .from("employee_discount_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .limit(1);

      if (error) throw error;

      return res.json({ success: true, data: data?.[0] || null });
    } catch (err) {
      console.error("getRule error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  async apply(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { employee_id, invoice_id, subtotal } = req.body;

      if (!employee_id || !invoice_id || !subtotal) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // 1. Get active rule
      const { data: rules, error: ruleErr } = await supabase
        .from("employee_discount_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .limit(1);

      if (ruleErr) throw ruleErr;
      if (!rules?.length) {
        return res.status(400).json({ error: "No employee discount rule found" });
      }

      const rule = rules[0];

      // 2. Base discount from percent
      let discount = (Number(subtotal) * Number(rule.discount_percent || 0)) / 100;

      // 3. Cap 1: per-bill max
      if (rule.max_discount_amount && discount > rule.max_discount_amount) {
        discount = Number(rule.max_discount_amount);
      }

      // 4. Cap 2: monthly limit
      if (rule.monthly_limit) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startISO = startOfMonth.toISOString();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextISO = nextMonth.toISOString();

        const { data: usedRows, error: usedErr } = await supabase
          .from("employee_discount_usage")
          .select("discount_amount, used_at")
          .eq("tenant_id", tenant_id)
          .eq("employee_id", employee_id)
          .gte("used_at", startISO)
          .lt("used_at", nextISO);

        if (usedErr) throw usedErr;

        const monthly_used = (usedRows || []).reduce(
          (sum, row) => sum + Number(row.discount_amount || 0),
          0
        );

        const remaining = Number(rule.monthly_limit) - monthly_used;

        if (remaining <= 0) {
          discount = 0;
        } else if (discount > remaining) {
          discount = remaining;
        }
      }

      if (discount < 0) discount = 0;

      const final_amount = Number(subtotal) - discount;

      // 5. Save usage
      const { error: insertErr } = await supabase
        .from("employee_discount_usage")
        .insert([
          {
            tenant_id,
            employee_id,
            invoice_id,
            discount_amount: discount,
          },
        ]);

      if (insertErr) throw insertErr;

      return res.json({
        success: true,
        discount,
        final_amount,
      });
    } catch (err) {
      console.error("apply employee discount error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  async getUsage(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const employee_id = req.params.employee_id;

      const { data, error } = await supabase
        .from("employee_discount_usage")
        .select("*, invoices(invoice_number)")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .order("used_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (err) {
      console.error("getUsage error:", err);
      return res.status(500).json({ error: err.message });
    }
  },
};
