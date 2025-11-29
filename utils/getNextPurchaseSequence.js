import { supabase } from "../supabase/supabaseClient.js";

export async function getNextPurchaseSequence(tenant_id) {
  // 1️⃣ Fetch counter
  const { data: counter } = await supabase
    .from("tenant_counters")
    .select("*")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  let nextSeq = 1;

  if (!counter) {
    // 2️⃣ First purchase for tenant → create row
    const { error } = await supabase
      .from("tenant_counters")
      .insert([{ tenant_id, purchase_seq: 1 }]);

    if (error) throw error;

    nextSeq = 1;
  } else {
    // 3️⃣ Increment existing sequence
    nextSeq = counter.purchase_seq + 1;

    const { error } = await supabase
      .from("tenant_counters")
      .update({ purchase_seq: nextSeq })
      .eq("tenant_id", tenant_id);

    if (error) throw error;
  }

  return nextSeq;
}
