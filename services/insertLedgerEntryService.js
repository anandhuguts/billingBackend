import { supabase } from "../supabase/supabaseClient.js";

export async function insertLedgerEntry({
  tenant_id,
  account_type,
  account_id = null,
  entry_type,
  description,
  debit = 0,
  credit = 0,
  reference_id = null,
}) {
  const { data: lastRows, error: lastErr } = await supabase
    .from("ledger_entries")
    .select("id, balance")
    .eq("tenant_id", tenant_id)
    .eq("account_type", account_type)
    .order("created_at", { ascending: false })
    .limit(1);

  let prevBalance = 0;
  if (!lastErr && lastRows && lastRows.length > 0) {
    prevBalance = Number(lastRows[0].balance || 0);
  }

  const newBalance =
    Number(prevBalance) + Number(debit || 0) - Number(credit || 0);

  const { error: insertErr } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_type,
      account_id,
      entry_type,
      description,
      debit,
      credit,
      balance: newBalance,
      reference_id,
    },
  ]);

  if (insertErr) throw insertErr;
}