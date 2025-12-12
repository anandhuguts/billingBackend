// services/insertLedgerEntryService.js
import { supabase } from "../supabase/supabaseClient.js";

export async function insertLedgerEntry({
  tenant_id,
  // account_type removed on purpose — use account_id (COA id)
  account_id, // REQUIRED: integer COA id
  entry_type = "manual",
  description = "",
  debit = 0,
  credit = 0,
  reference_id = null,
  reference_type = null,
}) {
  if (!account_id) {
    throw new Error("account_id (COA id) is required for ledger posting");
  }

  // 1) fetch COA info (id, type)
  const { data: coa, error: coaErr } = await supabase
    .from("coa")
    .select("id, type")
    .eq("id", account_id)
    .maybeSingle();

  if (coaErr) throw coaErr;
  if (!coa) throw new Error(`COA account not found: id=${account_id}`);

  const accountType = coa.type; // asset | liability | income | expense | group | equity

  // 2) fetch last balance for this account (keep same behavior for now)
  const { data: lastRows, error: lastErr } = await supabase
    .from("ledger_entries")
    .select("id, balance")
    .eq("tenant_id", tenant_id)
    .eq("account_id", account_id)
    .order("id", { ascending: false })
    .limit(1);

  if (lastErr) throw lastErr;

  let prevBalance = 0;
  if (lastRows && lastRows.length > 0) {
    prevBalance = Number(lastRows[0].balance || 0);
  }

  // 3) compute new balance using accounting rules
  // Assets & Expenses: balance = prev + debit - credit
  // Liabilities, Income, Equity: balance = prev - debit + credit
  let newBalance;
  if (accountType === "asset" || accountType === "expense") {
    newBalance = Number(prevBalance) + Number(debit || 0) - Number(credit || 0);
  } else if (
    accountType === "liability" ||
    accountType === "income" ||
    accountType === "equity"
  ) {
    newBalance = Number(prevBalance) - Number(debit || 0) + Number(credit || 0);
  } else {
    // fallback same as asset/expense
    newBalance = Number(prevBalance) + Number(debit || 0) - Number(credit || 0);
  }

  // 4) insert ledger row
  const { data: inserted, error: insertErr } = await supabase
    .from("ledger_entries")
    .insert([
      {
        tenant_id,
        account_type: accountType, // keep for debugging but account_id is authoritative
        account_id,
        entry_type,
        description,
        debit,
        credit,
        balance: newBalance,
        reference_id,
        reference_type,
      },
    ])
    .select()
    .maybeSingle();

  if (insertErr) throw insertErr;

  return inserted;
}
