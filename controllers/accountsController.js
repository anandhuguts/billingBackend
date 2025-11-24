import { supabase } from "../supabase/supabaseClient.js";

/* -----------------------------------------
   1. DAYBOOK
------------------------------------------ */
export const getDaybook = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("daybook")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("date", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   2. LEDGER
------------------------------------------ */
export const getLedger = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("ledger_entries")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   3. TRIAL BALANCE
------------------------------------------ */
export const getTrialBalance = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("ledger_entries")
      .select("*")
      .eq("tenant_id", tenant_id);

    if (error) throw error;

    const totalDebit = data.reduce((a, b) => a + Number(b.debit), 0);
    const totalCredit = data.reduce((a, b) => a + Number(b.credit), 0);

    return res.json({
      success: true,
      data,
      totals: { debit: totalDebit, credit: totalCredit },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   4. BALANCE SHEET
------------------------------------------ */
export const getBalanceSheet = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // Cash = sum of all credits - debits
    const { data: ledger } = await supabase
      .from("ledger_entries")
      .select("*")
      .eq("tenant_id", tenant_id);

    const assets =
      ledger.reduce((a, b) => a + Number(b.debit - b.credit), 0);

    const liabilities =
      ledger.reduce((a, b) => a + Number(b.credit - b.debit), 0);

    return res.json({
      success: true,
      assets,
      liabilities,
      equity: assets - liabilities,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   5. VAT REPORT
------------------------------------------ */
export const getVATReport = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id);

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
