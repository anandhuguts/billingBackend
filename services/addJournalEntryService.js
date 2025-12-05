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
  const { error } = await supabase.from("journal_entries").insert([
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

  if (error) throw error;
}