import { supabase } from "../supabase/supabaseClient.js";

function getCurrentPeriod() {
  return new Date().toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export const VatController = {
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("vat_reports")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("id", { ascending: false });

      if (error) throw error;

      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  async generateForMonth(req, res) {
    try {
      const { tenant_id } = req.user;
      const period = req.body.period || getCurrentPeriod();

      // Auto-calc total sales & VAT from invoices
      const { data: invoices, error: invoiceErr } = await supabase
        .from("invoices")
        .select("*")
        .eq("tenant_id", tenant_id);

      if (invoiceErr) throw invoiceErr;

      let totalSales = 0;
      let salesVAT = 0;

      invoices.forEach((i) => {
        totalSales += i.final_amount;
        salesVAT += i.vat_amount || 0;
      });

      const vatPayable = salesVAT; // no purchase VAT included yet

      const { data, error } = await supabase
        .from("vat_reports")
        .insert([
          {
            tenant_id,
            period,
            total_sales: totalSales,
            sales_vat: salesVAT,
            purchase_vat: 0,
            vat_payable: vatPayable,
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
