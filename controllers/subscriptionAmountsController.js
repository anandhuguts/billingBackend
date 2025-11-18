import { supabase } from "../supabase/supabaseClient.js";

// Controller for subscription amounts API.
// Tries to read from `subscription_amount_plan` first; if that table is absent
// or errors, falls back to `Subscription_Plans_amount_set` and normalizes rows.

export const getSubscriptionAmounts = async (req, res) => {
  try {
    // Try singular table first
    try {
      const { data, error } = await supabase
        .from("Subscription_Plans_amount_set")
        .select("*");
      if (!error && Array.isArray(data)) {
        return res.json({ plans: data });
      }
      // If error, fall through to fallback
      console.info(
        "subscription_amount_plan read returned error or no data, falling back",
        error
      );
    } catch (e) {
      // Likely table doesn't exist — continue to fallback
      console.info(
        "subscription_amount_plan query failed, fallback will run",
        e?.message || e
      );
    }

    // Fallback: read Subscription_Plans_amount_set and map to expected shape
    const { data: fallbackData, error: fallbackErr } = await supabase
      .from("Subscription_Plans_amount_set")
      .select("*");

    if (fallbackErr) {
      console.error(
        "Failed to read fallback Subscription_Plans_amount_set:",
        fallbackErr
      );
      return res
        .status(500)
        .json({ error: "Failed to fetch subscription amounts" });
    }

    // Normalize column names to a simpler shape if needed
    const normalized = (fallbackData || []).map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      billing: r.billing,
      reports: r.reports,
      inventory: r.inventory,
      user: r.user,
      amc_amount: r.amc_amount ?? r.amc ?? 0,
    }));

    return res.json({ plans: normalized });
  } catch (err) {
    console.error("getSubscriptionAmounts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  getSubscriptionAmounts,
};
