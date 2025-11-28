import { supabase } from "../supabase/supabaseClient.js";

export const makeCustomerPayment = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const customer_id = req.params.id;
    const { invoice_id, amount, method = "cash", note = "" } = req.body;

    if (!invoice_id || !amount)
      return res.status(400).json({ error: "invoice_id and amount required" });

    const { data, error } = await supabase
      .from("customer_payment")
      .insert([
        {
          tenant_id,
          invoice_id,
          customer_id,
          amount,
          method,
          note,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: "Payment recorded",
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
export const getCustomerLedger = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const customer_id = req.params.id;

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_number, final_amount, created_at")
      .eq("tenant_id", tenant_id)
      .eq("customer_id", customer_id)
      .order("created_at");

    const invoiceIds = invoices.map((i) => i.id);

    let payments = [];
    if (invoiceIds.length > 0) {
      const { data } = await supabase
        .from("customer_payment")
        .select("*")
        .eq("tenant_id", tenant_id)
        .in("invoice_id", invoiceIds)
        .order("created_at");

      payments = data || [];
    }

    const ledger = [];

    for (const inv of invoices) {
      ledger.push({
        date: inv.created_at,
        type: "invoice",
        description: `Invoice #${inv.invoice_number}`,
        debit: Number(inv.final_amount),
        credit: 0,
      });
    }

    for (const p of payments) {
      ledger.push({
        date: p.created_at,
        type: "payment",
        description: p.note || "Payment",
        debit: 0,
        credit: Number(p.amount),
      });
    }

    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

    let balance = 0;
    const ledgerWithBalance = ledger.map((row) => {
      balance += row.debit - row.credit;
      return { ...row, balance };
    });

    return res.json({
      success: true,
      customer_id,
      transactions: ledgerWithBalance,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
export const getCustomerAgeing = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, customer_id, invoice_number, final_amount, created_at")
      .eq("tenant_id", tenant_id);

    if (!invoices.length) return res.json({ ageing: [] });

    const invoiceIds = invoices.map((i) => i.id);

    const { data: payments } = await supabase
      .from("customer_payment")
      .select("invoice_id, amount")
      .eq("tenant_id", tenant_id)
      .in("invoice_id", invoiceIds);

    const payMap = {};
    (payments || []).forEach((p) => {
      if (!payMap[p.invoice_id]) payMap[p.invoice_id] = 0;
      payMap[p.invoice_id] += Number(p.amount);
    });

    const today = new Date();
    const result = {
      "0-30": [],
      "31-60": [],
      "61-90": [],
      "90+": [],
    };

    for (const inv of invoices) {
      const paid = payMap[inv.id] || 0;
      const due = Number(inv.final_amount) - paid;
      if (due <= 0) continue;

      const ageDays = Math.floor((today - new Date(inv.created_at)) / 86400000);

      const row = {
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        invoice_number: inv.invoice_number,
        amount: inv.final_amount,
        paid,
        due,
        age: ageDays,
      };

      if (ageDays <= 30) result["0-30"].push(row);
      else if (ageDays <= 60) result["31-60"].push(row);
      else if (ageDays <= 90) result["61-90"].push(row);
      else result["90+"].push(row);
    }

    return res.json({ success: true, ageing: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
