import { supabase } from "../supabase/supabaseClient.js";

export async function getNextPurchaseSequence(tenant_id) {
  // 1️⃣ Extract the highest invoice_number from purchases table
  const { data: purchases, error: maxErr } = await supabase
    .from("purchases")
    .select("invoice_number")
    .eq("tenant_id", tenant_id)
    .like("invoice_number", "PUR-%")
    .order("invoice_number", { ascending: false })
    .limit(1);

  if (maxErr) throw maxErr;

  let lastSeq = 0;

  if (purchases && purchases.length > 0) {
    const lastInv = purchases[0].invoice_number; // PUR-2025-0012
    const parts = lastInv.split("-"); // ["PUR", "2025", "0012"]
    lastSeq = parseInt(parts[2]); // 12
  }

  // 2️⃣ Sync with tenant_counters
  const { data: counter } = await supabase
    .from("tenant_counters")
    .select("*")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  let seqFromCounter = counter?.purchase_seq || 0;

  // 3️⃣ Final sequence uses the highest of the two
  const nextSeq = Math.max(lastSeq, seqFromCounter) + 1;

  // 4️⃣ Update tenant_counters
  if (!counter) {
    await supabase
      .from("tenant_counters")
      .insert([{ tenant_id, purchase_seq: nextSeq }]);
  } else {
    await supabase
      .from("tenant_counters")
      .update({ purchase_seq: nextSeq })
      .eq("tenant_id", tenant_id);
  }

  return nextSeq;
}
