import { supabase } from "../supabase/supabaseClient.js";
import { getModulesByCategory } from "../helpers/moduleHelper.js";

export const getModulesForTenant = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from("tenants").select("category, module_settings").eq("id", id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Tenant not found" });

    const categoryModules = getModulesByCategory(data.category);
    const enabledModules = data.module_settings || {};
    res.json({ available: categoryModules, enabled: enabledModules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateModulesForTenant = async (req, res) => {
  const { id } = req.params;
  const { modules } = req.body;
  if (!modules || typeof modules !== "object") return res.status(400).json({ error: "Invalid modules data" });

  try {
    const { data, error } = await supabase.from("tenants").update({ module_settings: modules }).eq("id", id).select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Tenant not found" });

    res.json({ message: "Modules updated", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
