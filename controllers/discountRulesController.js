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

      const allowedTypes = ["item", "bill", "coupon", "tier"];

      // Validate type
      if (!allowedTypes.includes(body.type)) {
        return res.status(400).json({
          error: `Invalid discount type. Allowed types: ${allowedTypes.join(", ")}`,
        });
      }

      // Coupon must have a code
      if (body.type === "coupon" && !body.code) {
        return res.status(400).json({ error: "Coupon code is required" });
      }

      // Prevent duplicate coupon codes (case-insensitive)
      if (body.type === "coupon") {
        const { data: existing, error: checkError } = await supabase
          .from("discount_rules")
          .select("id, code")
          .eq("tenant_id", tenant_id)
          .ilike("code", body.code);  // ✅ FIXED: Case-insensitive check

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
          return res.status(400).json({
            error: `Coupon code '${body.code}' already exists (case-insensitive)`,
          });
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
