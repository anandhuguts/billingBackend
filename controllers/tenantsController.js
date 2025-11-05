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
  const { name, email, password, category, plan, status } = req.body;
  if (!name || !email || !password || !category)
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
  console.log("Update tenant request body:", req.body);
  const { id } = req.params;
  const { name, email, password, category, plan, status, modules } = req.body;
  try {
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (category) updateData.category = category;
    if (plan) updateData.plan = plan;
    if (status) updateData.status = status;
    if (modules) updateData.modules = modules;
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

// DELETE tenant
export const deleteTenant = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("tenants")
      .delete()
      .eq("id", id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: "Tenant not found" });
    res.json({ message: "Tenant deleted", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
