import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";

// Helper: Calculate AMC expiration information
const calculateAMCInfo = (amc) => {
  if (!amc || !amc.end_date) return {};

  const today = new Date();
  const endDate = new Date(amc.end_date);
  const startDate = new Date(amc.start_date);

  const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const isExpired = today > endDate;
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

// GET all tenants
export const getAllTenants = async (req, res) => {
  const { data, error } = await supabase.from("tenants").select("*");
  if (error) return res.status(500).json({ error });
  res.json(data);
};

// GET single tenant
// Fetch tenant with all associated AMC records
export const getTenantById = async (req, res) => {
  const { id } = req.params;

  try {
    // Step 1: Get tenant data
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", id)
      .single();

    if (tenantError) {
      console.error("Error fetching tenant:", tenantError);
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Step 2: Get all AMC records for this tenant
    const { data: amcData, error: amcError } = await supabase
      .from("amc")
      .select("*")
      .eq("tenat_amcid", id)
      .order("start_date", { ascending: false });

    if (amcError) {
      console.error("Error fetching AMC data:", amcError);
      // Return tenant without AMC data if there's an error
      return res.json({
        tenant: tenantData,
        amc: [],
        warning: "Could not fetch AMC data",
      });
    }

    // Add expiration info to each AMC record
    const amcsWithInfo = (amcData || []).map((amc) => ({
      ...amc,
      expiration_info: calculateAMCInfo(amc),
    }));

    // Return tenant with AMC information including expiration details
    res.json({
      tenant: tenantData,
      amc: amcsWithInfo,
    });
  } catch (err) {
    console.error("Unexpected error in getTenantById:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// CREATE tenant
// When a tenant is created, also create a corresponding user in the users table
// The user record will be linked to the tenant via the tenant_id foreign key
export const createTenant = async (req, res) => {
  const { name, email, password, category, plan, status, phone } = req.body;
  if (!name || !email || !password || !category || !phone)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 1: Insert into tenants table first
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .insert([
        {
          name,
          email,
          password: hashedPassword,
          category,
          plan: plan || "trial",
          status: status || "active",
          phone,
        },
      ])
      .select();

    if (tenantError) {
      console.error("Error creating tenant:", tenantError);
      return res.status(500).json({ error: tenantError.message });
    }

    // Get the created tenant with its auto-generated ID
    const createdTenant = tenantData[0];
    console.log("Tenant created with ID:", createdTenant.id);

    // --- Auto-create an initial payment record based on selected plan ---
    // Assumption: initial payment amount uses monthly rates per plan.
    // If plan is 'trial' or not recognized, amount will be 0 and status set to 'trial'.
    const planMonthlyRates = {
      basic: 1000,
      professional: 2500,
      enterprise: 3500,
    };

    const tenantPlan = createdTenant.plan || "trial";
    const amountForPlan = planMonthlyRates[tenantPlan] || 0;
    const paymentStatus = amountForPlan > 0 ? "paid" : "trial";

    let createdPayment = null;
    try {
      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .insert([
          {
            tenant_id: createdTenant.id,
            amount: amountForPlan,
            currency: "USD",
            plan: tenantPlan,
            payment_date: new Date().toISOString(),
            status: paymentStatus,
            transaction_id: `init_${Date.now()}`,
          },
        ])
        .select();

      if (paymentError) {
        console.error(
          "Error creating initial payment for tenant:",
          paymentError
        );
      } else {
        createdPayment =
          paymentData && paymentData.length ? paymentData[0] : null;
        console.log("Initial payment created for tenant:", createdPayment?.id);
      }
    } catch (err) {
      console.error("Unexpected error creating initial payment:", err);
    }

    // Step 2: Insert into users table with tenant_id foreign key
    // This links the user to the tenant via the tenant_id column
    const { data: userData, error: userError } = await supabase
      .from("users")
      .insert([
        {
          full_name: name,
          email: email,
          password: hashedPassword,
          role: "tenant", // Default role for tenant users
          tenant_id: createdTenant.id, // Foreign key linking to tenants table
          is_active: status === "active" ? true : false,
        },
      ])
      .select();

    // If user creation fails, log the error but don't fail the whole request
    if (userError) {
      console.error("Error creating user:", userError);
      // Return tenant + payment data with warning about user creation
      return res.status(201).json({
        message: "Tenant created but user creation failed",
        tenant: createdTenant,
        payment: createdPayment,
        warning: userError.message,
      });
    }

    console.log("User created with tenant_id:", userData[0].tenant_id);

    // Both tenant, initial payment (if created), and user created successfully
    res.status(201).json({
      message: "Tenant, user, and initial payment created successfully",
      tenant: createdTenant,
      user: userData[0],
      payment: createdPayment,
    });
  } catch (err) {
    console.error("Unexpected error in createTenant:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// UPDATE tenant
// Update tenant and return with all associated AMC records
export const updateTenant = async (req, res) => {
  const { id } = req.params;
  const { name, email, password, category, plan, status, phone, modules } =
    req.body;
  try {
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (category) updateData.category = category;
    if (plan) updateData.plan = plan;
    if (status) updateData.status = status;
    if (modules) updateData.modules = modules;
    if (phone) updateData.phone = phone;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("tenants")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: "Tenant not found" });

    // Fetch AMC records for this tenant
    const { data: amcData, error: amcError } = await supabase
      .from("amc")
      .select("*")
      .eq("tenat_amcid", id)
      .order("start_date", { ascending: false });

    if (amcError) {
      console.error("Error fetching AMC data:", amcError);
    }

    // Add expiration info to each AMC record
    const amcsWithInfo = (amcData || []).map((amc) => ({
      ...amc,
      expiration_info: calculateAMCInfo(amc),
    }));

    res.json({
      message: "Tenant updated",
      tenant: data[0],
      amc: amcsWithInfo,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// update tenant phone number
export const updateTenantPhoneNumber = async (req, res) => {
  const { id } = req.params;
  const { phone } = req.body;

  if (!phone) return res.status(400).json({ error: "Missing phone number" });

  try {
    const { data, error } = await supabase
      .from("tenants")
      .update({ phone })
      .eq("id", id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: "Tenant not found" });

    res.json({ message: "Tenant phone updated", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Aggregated details endpoint:
 * GET /api/tenants/:id/details
 * Joins tenant + latest AMC + latest payment.
 * Returns UI-ready DTO with preformatted strings.
 */
export const getTenantDetails = async (req, res) => {
  const { id } = req.params;

  // 1) tenant
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select(
      "id, name, email, phone, category, plan, status, created_at, updated_at, modules"
    )
    .eq("id", id)
    .single();

  if (tErr || !tenant) {
    return res.status(404).json({ error: tErr?.message || "Tenant not found" });
  }

  // 2) most recent AMC for this tenant (by end_date desc, then start_date desc)
  const { data: amcRow, error: aErr } = await supabase
    .from("amc")
    .select(
      "id, amc_number, plan, start_date, end_date, status, amount, billing_frequency, currency"
    )
    .eq("tenat_amcid", id)
    .order("end_date", { ascending: false })
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr) {
    return res.status(500).json({ error: aErr.message });
  }

  // 3) latest payment for this tenant
  const { data: paymentRow, error: pErr } = await supabase
    .from("payments")
    .select("id, payment_date, amount, plan, status, currency")
    .eq("tenant_id", id)
    .order("payment_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pErr) {
    return res.status(500).json({ error: pErr.message });
  }

  // currency fallback (prefer AMC currency; else payment; else AED)
  const currency = amcRow?.currency || paymentRow?.currency || "AED";

  // build DTO
  const dto = {
    tenant,
    amc: amcRow
      ? {
          amc_id: amcRow.id,
          amc_number: amcRow.amc_number ?? null,
          amc_status: computeAmcStatus(amcRow.start_date, amcRow.end_date),
          billing_frequency: amcRow.billing_frequency ?? null,
          billing_frequency_label: freqLabel(amcRow.billing_frequency),
          currency,
          amount: amcRow.amount ?? null,
          amount_display: formatCurrency(amcRow.amount, currency),
          start_date: amcRow.start_date ?? null,
          start_date_display: formatDateDisplay(amcRow.start_date),
          end_date: amcRow.end_date ?? null,
          end_date_display: formatDateDisplay(amcRow.end_date),
        }
      : null,
    latest_payment: paymentRow
      ? {
          id: paymentRow.id,
          payment_date: paymentRow.payment_date ?? null,
          payment_date_display: formatDateDisplay(paymentRow.payment_date),
          amount: paymentRow.amount ?? null,
          amount_display: formatCurrency(paymentRow.amount, currency),
          plan: paymentRow.plan ?? null,
          status: paymentRow.status ?? null,
        }
      : null,
  };

  return res.json(dto);
};
// DELETE tenant
export const deleteTenant = async (req, res) => {
  const { id } = req.params;
  try {
    // First, delete dependent records to avoid FK or orphaned rows.
    // Delete users linked to tenant
    let deletedUsers = [];
    try {
      const { data: du, error: duErr } = await supabase
        .from("users")
        .delete()
        .eq("tenant_id", id)
        .select();
      if (duErr) console.warn("Failed to delete users for tenant", id, duErr);
      deletedUsers = du || [];
    } catch (e) {
      console.warn("Unexpected error deleting users for tenant", id, e);
    }



    // Finally delete the tenant row
    const { data, error } = await supabase
      .from("tenants")
      .delete()
      .eq("id", id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: "Tenant not found" });

    res.json({
      message: "Tenant and related data deleted",
      tenant: data[0],
      deleted: {
        users: deletedUsers.length,
        
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
