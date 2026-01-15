import { supabase } from "../supabase/supabaseClient.js";

/**
 * FIXED: Now uses atomic RPC to prevent race conditions
 * Old logic had read-modify-write race condition that could generate duplicate purchase numbers
 */
export async function getNextPurchaseSequence(tenant_id) {
  const { data, error } = await supabase
    .rpc('get_next_purchase_seq', { p_tenant_id: tenant_id });

  if (error) {
    console.error("❌ Purchase sequence generation failed:", error);
    throw error;
  }

  return data;
}

