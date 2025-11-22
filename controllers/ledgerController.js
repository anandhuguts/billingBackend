import { supabase } from "../supabase/supabaseClient.js";

export const LedgerController = {
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("id", { ascending: false });

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  async getByAccount(req, res) {
    try {
      const { tenant_id } = req.user;
      const { account_id } = req.params;

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("account_id", account_id)
        .order("id", { ascending: false });

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
};
