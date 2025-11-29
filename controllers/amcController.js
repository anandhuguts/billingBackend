// amcController.js
// Controller for Annual Maintenance Contract (AMC) related endpoints.
// This controller uses the Supabase client to read/write the `amc` table.
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

// Helper: Calculate AMC expiration information
// Returns additional info like days remaining, expired status, etc.
const calculateAMCInfo = (amc) => {
  if (!amc || !amc.end_date) return {};

  const today = new Date();
  const endDate = new Date(amc.end_date);
  const startDate = new Date(amc.start_date);

  // Calculate days remaining (can be negative if expired)
  const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

  // Calculate total duration in days
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  // Determine if expired
  const isExpired = today > endDate;

  // Determine if expiring soon (within 30 days)
  const isExpiringSoon = daysRemaining > 0 && daysRemaining <= 30;

  return {
    is_expired: isExpired,
    is_expiring_soon: isExpiringSoon,
    days_remaining: daysRemaining,
    total_duration_days: totalDays,
    expiry_date: amc.end_date,
    start_date: amc.start_date,
    status_message: isExpired
      ? `Expired ${Math.abs(daysRemaining)} days ago`
      : isExpiringSoon
      ? `Expiring in ${daysRemaining} days`
      : `${daysRemaining} days remaining`,
  };
};

// GET all AMC records
// Purpose: Fetch all annual maintenance contracts from the database with expiration info
// Inputs: None (req.query can be used for filtering in future)
// Output: JSON array of all AMC records with calculated expiration details
export const getAllAMCs = async (req, res) => {
  try {
    // Query Supabase `amc` table for all records
    // Order by start_date descending (newest first)
    const { data, error } = await supabase
      .from("amc")
      .select("*")
      .order("start_date", { ascending: false });

    // If Supabase returned an error, forward it
    if (error) {
      console.error("Supabase error fetching AMCs:", error);
      return res.status(500).json({ error: error.message || error });
    }

    // Add expiration info to each AMC record
    const amcsWithInfo = data.map((amc) => ({
      ...amc,
      expiration_info: calculateAMCInfo(amc),
    }));

    // Return the list of AMC records with expiration info
    return res.status(200).json({ amcs: amcsWithInfo });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in getAllAMCs:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET single AMC record by ID
// Purpose: Fetch a specific AMC contract by its unique id with expiration info
// Inputs: req.params.id -> AMC id (uuid)
// Output: JSON object of the AMC record with calculated expiration details
export const getAMCById = async (req, res) => {
  // Extract AMC id from URL params
  const amcId = req.params.id;

  // Basic validation: AMC id must be provided
  if (!amcId) {
    return res.status(400).json({ error: "AMC id is required" });
  }

  // Normalize AMC id to avoid invalid UUID strings
  const cleanedAmcId = normalizeUuid(amcId);

  try {
    // Query Supabase `amc` table for a specific record
    const { data, error } = await supabase
      .from("amc")
      .select("*")
      .eq("id", cleanedAmcId)
      .single(); // Expect single result

    // If Supabase returned an error, check if it's a "not found" case
    if (error) {
      console.error("Supabase error fetching AMC by id:", error);
      return res.status(404).json({ error: "AMC record not found" });
    }

    // Add expiration info to the AMC record
    const amcWithInfo = {
      ...data,
      expiration_info: calculateAMCInfo(data),
    };

    // Return the AMC record with expiration info
    return res.status(200).json({ amc: amcWithInfo });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in getAMCById:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// CREATE a new AMC record
// Purpose: Insert a new annual maintenance contract into the database
// Expected body: { client_name, plan, start_date, end_date, status, amount, billing_frequency, tenant_id }
// Returns: the inserted AMC record or an error
export const createAMC = async (req, res) => {
  // Extract expected fields from request body
  const {
    client_name,
    plan,
    start_date,
    end_date,
    status = true, // default status to true (active) if not provided
    amount,
    billing_frequency = null,
    tenant_id = null, // Foreign key to tenants table
  } = req.body || {};

  // Basic validation: required fields
  if (!client_name || !plan || !start_date || !end_date) {
    return res.status(400).json({
      error: "client_name, plan, start_date, and end_date are required",
    });
  }

  // Validate amount if provided
  if (amount !== undefined && amount !== null) {
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount)) {
      return res.status(400).json({ error: "amount must be a numeric value" });
    }
  }

  // Normalize tenant foreign key UUID if provided
  const cleanedTenantId = tenant_id ? normalizeUuid(tenant_id) : null;

  try {
    // Insert the record into Supabase `amc` table
    const { data, error } = await supabase
      .from("amc")
      .insert([
        {
          client_name,
          plan,
          start_date,
          end_date,
          status,
          amount: amount ? Number(amount) : null,
          billing_frequency,
          tenant_id: cleanedTenantId,
        },
      ])
      .select(); // Return the inserted row

    // Handle Supabase insertion error
    if (error) {
      console.error("Supabase error inserting AMC:", error);
      return res.status(500).json({ error: error.message || error });
    }

    // Return the inserted row
    return res.status(201).json({ amc: data && data.length ? data[0] : data });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in createAMC:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// UPDATE an existing AMC record
// Purpose: Update fields of an existing annual maintenance contract
// Inputs: req.params.id -> AMC id (uuid), req.body -> fields to update
// Returns: the updated AMC record or an error
export const updateAMC = async (req, res) => {
  // Extract AMC id from URL params
  const amcId = req.params.id;

  // Basic validation: AMC id must be provided
  if (!amcId) {
    return res.status(400).json({ error: "AMC id is required" });
  }

  // Normalize AMC id
  const cleanedAmcId = normalizeUuid(amcId);

  // Extract fields to update from request body
  const {
    client_name,
    plan,
    start_date,
    end_date,
    status,
    amount,
    billing_frequency,
    tenant_id,
  } = req.body || {};

  // Build update object dynamically (only include provided fields)
  const updateData = {};
  if (client_name !== undefined) updateData.client_name = client_name;
  if (plan !== undefined) updateData.plan = plan;
  if (start_date !== undefined) updateData.start_date = start_date;
  if (end_date !== undefined) updateData.end_date = end_date;
  if (status !== undefined) updateData.status = status;
  if (amount !== undefined) {
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount)) {
      return res.status(400).json({ error: "amount must be a numeric value" });
    }
    updateData.amount = numericAmount;
  }
  if (billing_frequency !== undefined)
    updateData.billing_frequency = billing_frequency;

  // Handle tenant foreign key update with UUID normalization
  if (tenant_id !== undefined) {
    updateData.tenant_id = tenant_id ? normalizeUuid(tenant_id) : null;
  }

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "No fields provided to update" });
  }

  try {
    // Update the record in Supabase `amc` table
    const { data, error } = await supabase
      .from("amc")
      .update(updateData)
      .eq("id", cleanedAmcId)
      .select(); // Return the updated row

    // Handle Supabase update error or not found case
    if (error) {
      console.error("Supabase error updating AMC:", error);
      return res.status(500).json({ error: error.message || error });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "AMC record not found" });
    }

    // Return the updated AMC record
    return res
      .status(200)
      .json({ amc: data[0], message: "AMC updated successfully" });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in updateAMC:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE an AMC record
// Purpose: Remove an annual maintenance contract from the database
// Inputs: req.params.id -> AMC id (uuid)
// Returns: confirmation message or error
export const deleteAMC = async (req, res) => {
  // Extract AMC id from URL params
  const amcId = req.params.id;

  // Basic validation: AMC id must be provided
  if (!amcId) {
    return res.status(400).json({ error: "AMC id is required" });
  }

  // Normalize AMC id
  const cleanedAmcId = normalizeUuid(amcId);

  try {
    // Delete the record from Supabase `amc` table
    const { data, error } = await supabase
      .from("amc")
      .delete()
      .eq("id", cleanedAmcId)
      .select(); // Return the deleted row for confirmation

    // Handle Supabase delete error or not found case
    if (error) {
      console.error("Supabase error deleting AMC:", error);
      return res.status(500).json({ error: error.message || error });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "AMC record not found" });
    }

    // Return success message with deleted record
    return res
      .status(200)
      .json({ message: "AMC deleted successfully", amc: data[0] });
  } catch (err) {
    // Unexpected error handling
    console.error("Unexpected error in deleteAMC:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
