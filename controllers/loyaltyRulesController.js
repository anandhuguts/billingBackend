import { supabase } from "../supabase/supabaseClient.js";

export const LoyaltyRulesController = {
  /* ======================================================
     GET Active Rule (Tenant-Based)
  ====================================================== */
  async getActive(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("loyalty_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .single();

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({ error: "No active loyalty rule found" });
    }
  },

  /* ======================================================
     GET ALL RULES FOR TENANT
  ====================================================== */
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("loyalty_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("id", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* ======================================================
     CREATE RULE
  ====================================================== */
  async create(req, res) {
    try {
      const { tenant_id } = req.user;
      const { points_per_currency, currency_unit, start_date, end_date } = req.body;

      if (!points_per_currency || !currency_unit) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Deactivate existing active rule
      await supabase
        .from("loyalty_rules")
        .update({ is_active: false })
        .eq("tenant_id", tenant_id)
        .eq("is_active", true);

      const { data, error } = await supabase
        .from("loyalty_rules")
        .insert([
          {
            tenant_id,
            points_per_currency,
            currency_unit,
            start_date,
            end_date,
            is_active: true
          }
        ])
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, message: "Loyalty rule created", data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* ======================================================
     UPDATE RULE
  ====================================================== */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;
      const updateValues = req.body;

      const { data, error } = await supabase
        .from("loyalty_rules")
        .update(updateValues)
        .match({ id, tenant_id })
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, message: "Rule updated", data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
};
