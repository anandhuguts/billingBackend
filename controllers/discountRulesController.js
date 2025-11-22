import { supabase } from "../supabase/supabaseClient.js";

export const DiscountRulesController = {
  /* ======================================================
     GET ALL DISCOUNT RULES (TENANT)
  ====================================================== */
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("discount_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* ======================================================
     GET ONLY ACTIVE RULES
  ====================================================== */
  async getActive(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("discount_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* ======================================================
     CREATE DISCOUNT RULE
  ====================================================== */
  async create(req, res) {
    try {
      const { tenant_id } = req.user;
      const body = req.body;

      if (!body.type) {
        return res.status(400).json({ error: "Discount type is required" });
      }

      // Coupon must have a code
      if (body.type === "coupon" && !body.code) {
        return res.status(400).json({ error: "Coupon code is required" });
      }

      // Check duplicate coupon code per tenant
      if (body.type === "coupon") {
        const { data: exists } = await supabase
          .from("discount_rules")
          .select("id")
          .eq("tenant_id", tenant_id)
          .eq("code", body.code)
          .single();

        if (exists) {
          return res.status(400).json({ error: "Coupon code already exists for this tenant" });
        }
      }

      const { data, error } = await supabase
        .from("discount_rules")
        .insert([{ ...body, tenant_id }])
        .select("*")
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        message: "Discount rule created",
        data,
      });
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
      const body = req.body;

      const { data, error } = await supabase
        .from("discount_rules")
        .update(body)
        .match({ id, tenant_id })
        .select("*")
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        message: "Discount rule updated",
        data,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* ======================================================
     DEACTIVATE RULE
  ====================================================== */
  async deactivate(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("discount_rules")
        .update({ is_active: false })
        .match({ id, tenant_id })
        .select("*")
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        message: "Discount rule deactivated",
        data,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },
};
