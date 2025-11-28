import { supabase } from "../supabase/supabaseClient.js";

export const markPurchasePaid = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const purchase_id = req.params.id;
    const { amount, method = "cash", note = "" } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ error: "Invalid payment amount" });

    // 1️⃣ Fetch purchase
    const { data: purchase, error: purErr } = await supabase
      .from("purchases")
      .select("id, supplier_id, total_amount, amount_paid")
      .eq("tenant_id", tenant_id)
      .eq("id", purchase_id)
      .single();

    if (purErr || !purchase)
      return res.status(404).json({ error: "Purchase not found" });

    const outstanding =
      Number(purchase.total_amount) - Number(purchase.amount_paid);

    if (amount > outstanding)
      return res
        .status(400)
        .json({ error: "Payment exceeds outstanding amount" });

    // 2️⃣ Insert into supplier_payment
    const { error: payErr, data: payData } = await supabase
      .from("supplier_payment")
      .insert([
        {
          tenant_id,
          purchase_id,
          supplier_id: purchase.supplier_id,
          amount,
          method,
          note,
        },
      ])
      .select()
      .single();

    if (payErr) throw payErr;

    // 3️⃣ Update purchase paid status
    const newPaid = Number(purchase.amount_paid) + amount;

    await supabase
      .from("purchases")
      .update({
        amount_paid: newPaid,
        is_paid: newPaid >= purchase.total_amount,
      })
      .eq("id", purchase_id);

    // 4️⃣ ACCOUNTING ENTRIES
    try {
      // Ledger credit Cash
      await supabase.from("ledger_entries").insert([
        {
          tenant_id,
          account_type: "cash",
          entry_type: "credit",
          description: `Payment for Purchase #${purchase_id}`,
          debit: 0,
          credit: amount,
          reference_id: purchase_id,
        },
      ]);

      // Ledger debit Accounts Payable
      await supabase.from("ledger_entries").insert([
        {
          tenant_id,
          account_type: "accounts_payable",
          account_id: purchase.supplier_id,
          entry_type: "debit",
          description: `Payment for Purchase #${purchase_id}`,
          debit: amount,
          credit: 0,
          reference_id: purchase_id,
        },
      ]);

      // JOURNAL ENTRY
      await supabase.from("journal_entries").insert([
        {
          tenant_id,
          debit_account: "Cash",
          credit_account: "Accounts Payable",
          amount,
          description: `Payment for Purchase #${purchase_id}`,
          reference_id: purchase_id,
          reference_type: "purchase_payment",
        },
      ]);
    } catch (accErr) {
      console.error("⚠ Accounting failed:", accErr);
    }

    return res.json({
      success: true,
      message: "Payment recorded successfully",
      payment: payData,
      outstanding: outstanding - amount,
    });
  } catch (err) {
    console.error("❌ markPurchasePaid error:", err);
    return res.status(500).json({ error: err.message });
  }
};
