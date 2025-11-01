// subscriberController.js
// Controller for subscription-related endpoints.
// This controller uses the Supabase client to read/write the `payments` table.
// Each function is commented for later analysis and maintenance.

import { supabase } from "../supabase/supabaseClient.js";

// Helper: normalize UUID string by trimming and removing surrounding braces
// This prevents common mistakes where clients send values like "{{uuid}}" or "{uuid}"
const normalizeUuid = (id) => {
  if (!id || typeof id !== "string") return id;
  // Trim whitespace
  let cleaned = id.trim();
  // Remove surrounding double-curly or single curly braces if present
  cleaned = cleaned.replace(/^\{+|\}+$/g, "");
  cleaned = cleaned.replace(/^\{{2}|\}{2}$/g, "");
  return cleaned;
};

// Get payments for a specific tenant by tenant id
// Inputs: req.params.id -> tenant id (uuid)
// Output: JSON array of payments or error
export const getPaymentsByTenant = async (req, res) => {
  // Extract tenant id from URL params
  const tenantId = req.params.id;

  // Basic validation: tenant id must be provided
  if (!tenantId) {
    return res.status(400).json({ error: "tenant id is required" });
  }

  // Normalize tenant id to avoid invalid UUID strings caused by template braces
  const cleanedTenantId = normalizeUuid(tenantId);

  try {
    // Query Supabase `payments` table for entries that match tenant_id
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("tenant_id", cleanedTenantId)
      .order("payment_date", { ascending: false });

    // If Supabase returned an error, forward it
    if (error) {
      // Log server-side for diagnostics
      console.error("Supabase error fetching payments:", error);
      return res.status(500).json({ error: error.message || error });
    }

    // Return the list of payments (may be empty array)
    return res.status(200).json({ payments: data });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in getPaymentsByTenant:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Create a new payment record in the `payments` table
// Expected body: { tenant_id, amount, currency, plan, payment_date, status, transaction_id }
// Returns: the inserted payment record or an error
export const createPayment = async (req, res) => {
  // Extract expected fields from request body
  const {
    tenant_id,
    amount,
    currency = "USD", // default currency if not provided
    plan = null,
    payment_date = new Date().toISOString(),
    status = "pending",
    transaction_id = null,
  } = req.body || {};

  // Basic validation: tenant_id and amount are required
  if (!tenant_id || amount === undefined || amount === null) {
    return res
      .status(400)
      .json({ error: "tenant_id and amount are required to create a payment" });
  }

  // Normalize tenant id to avoid uuid parse errors (e.g. values like "{{uuid}}")
  const cleanedTenantId = normalizeUuid(tenant_id);

  // Validate amount is a number
  const numericAmount = Number(amount);
  if (Number.isNaN(numericAmount)) {
    return res.status(400).json({ error: "amount must be a numeric value" });
  }

  try {
    // Insert the record into Supabase `payments` table
    const { data, error } = await supabase.from("payments").insert([
      {
        tenant_id: cleanedTenantId,
        amount: numericAmount,
        currency,
        plan,
        payment_date,
        status,
        transaction_id,
      },
    ]);

    // Handle Supabase insertion error
    if (error) {
      console.error("Supabase error inserting payment:", error);
      return res.status(500).json({ error: error.message || error });
    }

    // If a plan was provided in the payment payload, also update the tenant's plan
    let tenantUpdate = null;
    if (plan) {
      const { data: tData, error: tError } = await supabase
        .from("tenants")
        .update({ plan })
        .eq("id", cleanedTenantId)
        .select();

      if (tError) {
        // Log tenant update error but still return the created payment
        console.error("Supabase error updating tenant plan:", tError);
        // Include a warning in the response to inform the client
        return res
          .status(201)
          .json({
            payment: data,
            warning: "payment created but tenant plan update failed",
          });
      }

      tenantUpdate = tData && tData.length ? tData[0] : null;
    }

    // Return the inserted row(s) and optional tenant update
    return res.status(201).json({ payment: data, tenant: tenantUpdate });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in createPayment:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Optional: get all payments across tenants (useful for admin pages)
export const getAllPayments = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("Supabase error fetching all payments:", error);
      return res.status(500).json({ error: error.message || error });
    }

    return res.status(200).json({ payments: data });
  } catch (err) {
    console.error("Unexpected error in getAllPayments:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
