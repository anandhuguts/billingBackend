// planController.js
import { supabase } from "../supabase/supabaseClient.js";

/**
 * Normalize UUID-like strings or trim names.
 * Reused style from your other controllers.
 */
const normalizeString = (val) => {
  if (val === undefined || val === null) return val;
  if (typeof val !== "string") return String(val);
  return val.trim();
};

/**
 * GET /plans
 * Optional query: name=<planName> to fetch single plan
 */
export const getPlans = async (req, res) => {
  try {
    const planName = req.query.name ? normalizeString(req.query.name) : null;

    const query = supabase.from("Subscription_Plans_amount_set").select("*");
    if (planName) query.eq("name", planName);

    const { data, error } = await query.order("id", { ascending: true });

    if (error) {
      console.error("Supabase error fetching plans:", error);
      return res.status(500).json({ error: error.message || error });
    }

    return res.status(200).json({ plans: data });
  } catch (err) {
    console.error("Unexpected error in getPlans:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /plans
 * Body: { name, amount, billing, reports, inventory, user, amc_amount }
 * Creates a new plan row. If plan already exists, returns 409.
 */
export const createPlan = async (req, res) => {
  try {
    const {
      name,
      amount = 0,
      billing = true,
      reports = false,
      inventory = false,
      user = null,
      amc_amount = 0,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const normalizedName = normalizeString(name);

    // Check existence
    const { data: existing, error: eError } = await supabase
      .from("Subscription_Plans_amount_set")
      .select("id")
      .eq("name", normalizedName)
      .limit(1);

    if (eError) {
      console.error("Supabase error checking existing plan:", eError);
      return res.status(500).json({ error: eError.message || eError });
    }

    if (existing && existing.length) {
      return res.status(409).json({ error: "Plan with this name already exists" });
    }

    const { data, error } = await supabase.from("Subscription_Plans_amount_set").insert([
      {
        name: normalizedName,
        amount,
        billing,
        reports,
        inventory,
        user,
        amc_amount,
      },
    ]).select();

    if (error) {
      console.error("Supabase error creating plan:", error);
      return res.status(500).json({ error: error.message || error });
    }

    return res.status(201).json({ plan: data && data[0] ? data[0] : data });
  } catch (err) {
    console.error("Unexpected error in createPlan:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /plans/:name
 * Body: { amount, billing, reports, inventory, amc_amount, user }
 * Updates the plan amount and optional flags. If plan doesn't exist, it will create (upsert).
 * This endpoint acts like "admin set price".
 */
export const upsertPlanByName = async (req, res) => {
  try {
    const name = req.params.name ? normalizeString(req.params.name) : null;
    if (!name) return res.status(400).json({ error: "plan name is required in URL" });

    const {
      amount = undefined,
      billing = undefined,
      reports = undefined,
      inventory = undefined,
      amc_amount = undefined,
      user = undefined,
    } = req.body || {};

    // Build update object only with provided fields
    const updateObj = {};
    if (amount !== undefined) updateObj.amount = Number(amount);
    if (billing !== undefined) updateObj.billing = Boolean(billing);
    if (reports !== undefined) updateObj.reports = Boolean(reports);
    if (inventory !== undefined) updateObj.inventory = Boolean(inventory);
    if (amc_amount !== undefined) updateObj.amc_amount = Number(amc_amount);
    if (user !== undefined) updateObj.user = user;

    // Try to update existing row
    const { data: updated, error: uError } = await supabase
      .from("Subscription_Plans_amount_set")
      .update(updateObj)
      .eq("name", name)
      .select();

    if (uError) {
      // If update fails, log and continue to try insert
      console.error("Supabase error updating plan:", uError);
      return res.status(500).json({ error: uError.message || uError });
    }

    if (updated && updated.length) {
      return res.status(200).json({ plan: updated[0] });
    }

    // If no existing plan, insert a new one (upsert behaviour)
    const insertObj = {
      name,
      amount: updateObj.amount ?? 0,
      billing: updateObj.billing ?? true,
      reports: updateObj.reports ?? false,
      inventory: updateObj.inventory ?? false,
      amc_amount: updateObj.amc_amount ?? 0,
      user: updateObj.user ?? null,
    };

    const { data: inserted, error: iError } = await supabase
      .from("Subscription_Plans_amount_set")
      .insert([insertObj])
      .select();

    if (iError) {
      console.error("Supabase error creating plan (upsert):", iError);
      return res.status(500).json({ error: iError.message || iError });
    }

    return res.status(201).json({ plan: inserted[0] });
  } catch (err) {
    console.error("Unexpected error in upsertPlanByName:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
