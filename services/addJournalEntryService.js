import { supabase } from "../supabase/supabaseClient.js";

export async function addJournalEntry({
  tenant_id,
  debit_account,
  credit_account,
  amount,
  description,
  reference_id = null,
  reference_type = "invoice",
}) {



  // 1) Insert journal entry
  const { error: jErr } = await supabase.from("journal_entries").insert([
    {
      tenant_id,
      debit_account,
      credit_account,
      amount,
      description,
      reference_id,
      reference_type,
    },
  ]);

  
  if (jErr) throw jErr;

  // 2) Fetch COA accounts for these IDs
  const { data: accounts, error: coaErr } = await supabase
    .from("coa")
    .select("id, type, name")
    .in("id", [debit_account, credit_account]);



  if (coaErr) throw coaErr;

  const debitAcc = accounts.find((a) => a.id == debit_account);
  const creditAcc = accounts.find((a) => a.id == credit_account);

  if (!debitAcc || !creditAcc) {
    console.error("❌ COA lookup failed!", {
      debit_account,
      credit_account,
      accounts,
    });
    throw new Error("COA account lookup failed");
  }


  // 3) Ledger insert: debit
  await insertLedgerRow({
    tenant_id,
    account: debitAcc,
    debit: amount,
    credit: 0,
    description,
    reference_id,
    reference_type,
  });

  // 4) Ledger insert: credit
  await insertLedgerRow({
    tenant_id,
    account: creditAcc,
    debit: 0,
    credit: amount,
    description,
    reference_id,
    reference_type,
  });


}



async function insertLedgerRow({
  tenant_id,
  account,
  debit,
  credit,
  description,
  reference_id,
  reference_type,
}) {


  // Fetch previous balance
  const { data: last, error: lastErr } = await supabase
    .from("ledger_entries")
    .select("balance")
    .eq("tenant_id", tenant_id)
    .eq("account_id", account.id)
    .order("id", { ascending: false })
    .limit(1);

  const prev = last?.[0]?.balance || 0;

  let newBalance;
  if (account.type === "asset" || account.type === "expense") {
    newBalance = prev + debit - credit;
  } else {
    newBalance = prev - debit + credit;
  }

  // ⭐ FIX: ADD entry_type
  const entry_type = reference_type || "general";

  const { error: insertErr } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_id: account.id,
      account_type: account.type,
      entry_type,   // 🔥 REQUIRED FIELD
      debit,
      credit,
      balance: newBalance,
      description,
      reference_id,
      reference_type,
    },
  ]);



  if (insertErr) throw insertErr;
}
