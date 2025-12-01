import { supabase } from "../supabase/supabaseClient.js";

export const requireFeature = (feature) => {
  return async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;

      const { data: tenant, error } = await supabase
        .from("tenants")
        .select("plan")
        .eq("id", tenantId)
        .single();

      if (error || !tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const plan = tenant.plan.toLowerCase();

      // You define features allowed for each plan
      const FEATURES = {
        basic: ["billing", "inventory"],
        pro: ["billing", "inventory", "reports"],
        premium: ["billing", "inventory", "reports", "accounts"],
      };

      if (!FEATURES[plan] || !FEATURES[plan].includes(feature)) {
        return res.status(403).json({
          error: `Your plan does not allow access to ${feature}.`
        });
      }

      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  };
};
