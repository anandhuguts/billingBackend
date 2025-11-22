import { supabase } from "../supabase/supabaseClient.js";

export const DaybookController = {
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("daybook")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("id", { ascending: false });

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  async create(req, res) {
    try {
      const { tenant_id } = req.user;
      const { entry_type, description, debit, credit, reference_id } = req.body;

      const { data, error } = await supabase
        .from("daybook")
        .insert([
          {
            tenant_id,
            entry_type,
            description,
            debit,
            credit,
            reference_id,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
};
