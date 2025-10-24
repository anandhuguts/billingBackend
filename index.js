// index.js
import dotenv from "dotenv";
dotenv.config(); // <-- Load .env first

import express from "express";
import cors from "cors";
import { supabase } from "./supabase/supabaseClient.js";
import bcrypt from 'bcrypt';

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// GET all tenants
// =========================
app.get("/tenants", async (req, res) => {
  const { data, error } = await supabase.from("tenants").select("*");
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// =========================
// GET single tenant by ID
// =========================
app.get("/tenants/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("tenants").select("*").eq("id", id).single();
  if (error) return res.status(404).json({ error: "Tenant not found" });
  res.json(data);
});

// =========================
// CREATE a new tenant
// =========================
app.post("/tenants", async (req, res) => {
  const { name, email, password, category, plan, status } = req.body;

  if (!name || !email || !password || !category) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("tenants")
      .insert([{
        name,
        email,
        password: hashedPassword,
        category,
        plan: plan || "trial",
        status: status || "active",
      }])
      .select();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ 
      message: "Tenant created successfully", 
      tenant: data[0] 
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
// UPDATE a tenant by ID
// =========================
app.put("/tenants/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, password, category, plan, status, modules } = req.body;

  try {
    const updateData = {};

    // Dynamically include only provided fields
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (category !== undefined) updateData.category = category;
    if (plan !== undefined) updateData.plan = plan;
    if (status !== undefined) updateData.status = status;
    if (modules !== undefined) updateData.modules = modules; // ✅ handle modules

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabase
      .from("tenants")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: "Tenant not found" });

    res.json({ message: "Tenant updated successfully", tenant: data[0] });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// =========================
// DELETE a tenant by ID
// =========================
app.delete("/tenants/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase.from("tenants").delete().eq("id", id).select();

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Tenant not found" });

    res.json({ message: "Tenant deleted successfully", tenant: data[0] });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==========================================
// REPORTS API ENDPOINTS
// ==========================================

// GET Dashboard Statistics
// ==========================================
// OPTIMIZED SINGLE DASHBOARD API
// ==========================================
// ==========================================
// OPTIMIZED SINGLE DASHBOARD API (FIXED)
// ==========================================
app.get("/reports/dashboard", async (req, res) => {
  try {
    console.log("📊 Dashboard API called");

    // Parallel queries for better performance
    const [
      tenantsResult,
      activeTenantsResult,
      categoryResult,
      planResult,
      recentTenantsResult
    ] = await Promise.all([
      // Total tenants
      supabase.from("tenants").select("*", { count: "exact", head: true }),
      
      // Active tenants
      supabase.from("tenants").select("*", { count: "exact", head: true }).eq("status", "active"),
      
      // Category distribution
      supabase.from("tenants").select("category"),
      
      // Plan distribution
      supabase.from("tenants").select("plan"),
      
      // Recent tenants for growth chart (last 12 months)
      supabase.from("tenants")
        .select("created_at")
        .gte("created_at", new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString())
        .order("created_at", { ascending: true })
    ]);

    console.log("Total tenants count:", tenantsResult.count);
    console.log("Active tenants count:", activeTenantsResult.count);

    // Check for critical errors
    if (tenantsResult.error) {
      console.error("Tenants query error:", tenantsResult.error);
      throw new Error(`Tenants query failed: ${tenantsResult.error.message}`);
    }

    // Try to get expiring plans (optional)
    let expiringPlans = 0;
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const { count } = await supabase
        .from("tenants")
        .select("plan_expiry_date", { count: "exact", head: true })
        .not("plan_expiry_date", "is", null)
        .lte("plan_expiry_date", thirtyDaysFromNow.toISOString())
        .gte("plan_expiry_date", new Date().toISOString());
      
      expiringPlans = count || 0;
    } catch (error) {
      console.log("⚠️ Plan expiry column not found, skipping");
    }

    // Try to get active users (optional)
    let activeUsers = 0;
    try {
      const { count } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      
      activeUsers = count || 0;
    } catch (error) {
      console.log("⚠️ Users table not found, skipping");
    }

    // Process category distribution
    const categoryDistribution = (categoryResult.data || []).reduce((acc, tenant) => {
      const category = tenant.category || 'unknown';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    const categories = Object.entries(categoryDistribution).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    }));

    console.log("Categories:", categories);

    // Process plan distribution
    const planDistribution = (planResult.data || []).reduce((acc, tenant) => {
      const plan = tenant.plan || 'unknown';
      acc[plan] = (acc[plan] || 0) + 1;
      return acc;
    }, {});

    const plans = Object.entries(planDistribution).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    }));

    console.log("Plans:", plans);

    // Process tenant growth (group by month)
    const growthByMonth = (recentTenantsResult.data || []).reduce((acc, tenant) => {
      const date = new Date(tenant.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      
      if (!acc[monthKey]) {
        acc[monthKey] = { month: monthName, tenants: 0, sortKey: monthKey };
      }
      acc[monthKey].tenants += 1;
      
      return acc;
    }, {});

    const tenantGrowth = Object.values(growthByMonth)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ month, tenants }) => ({ month, tenants }));

    console.log("Tenant growth:", tenantGrowth);

    // Mock revenue data
    const revenueData = [
      { month: "Jan", revenue: 12000 },
      { month: "Feb", revenue: 15000 },
      { month: "Mar", revenue: 18000 },
      { month: "Apr", revenue: 22000 },
      { month: "May", revenue: 25000 },
      { month: "Jun", revenue: 28000 },
    ];

    const response = {
      stats: {
        totalTenants: tenantsResult.count || 0,
        activeTenants: activeTenantsResult.count || 0,
        activeUsers: activeUsers,
        expiringPlans: expiringPlans,
        totalRevenue: 268000,
      },
      categoryDistribution: categories,
      planDistribution: plans,
      tenantGrowth: tenantGrowth.length > 0 ? tenantGrowth : [
        { month: "No data", tenants: 0 }
      ],
      revenueData,
    };

    console.log("✅ Sending response:", response);

    res.json(response);

  } catch (error) {
    console.error("❌ Dashboard error:", error);
    res.status(500).json({ 
      error: error.message,
      details: "Check server logs for more info"
    });
  }
});

// ==========================================
// MODULE CONFIGURATION ENDPOINTS
// ==========================================

// GET modules for a specific tenant
app.get("/tenants/:id/modules", async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from("tenants")
      .select("category, module_settings")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Tenant not found" });

    // Get available modules based on category
    const categoryModules = getModulesByCategory(data.category);
    
    // Get enabled modules from tenant settings
    const enabledModules = data.module_settings || {};

    res.json({
      available: categoryModules,
      enabled: enabledModules
    });
  } catch (error) {
    console.error("Get modules error:", error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE modules for a specific tenant
app.put("/tenants/:id/modules", async (req, res) => {
  try {
    const { id } = req.params;
    const { modules } = req.body;

    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ error: "Invalid modules data" });
    }

    const { data, error } = await supabase
      .from("tenants")
      .update({ module_settings: modules })
      .eq("id", id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    res.json({ 
      message: "Modules updated successfully", 
      tenant: data[0] 
    });
  } catch (error) {
    console.error("Update modules error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get available modules by category
function getModulesByCategory(category) {
  const baseModules = {
    'POS': 'Point of Sale system',
    'Inventory': 'Stock management',
    'Reports': 'Analytics and reports',
    'Multi-branch': 'Multiple locations',
    'Users': 'User management',
    'Billing': 'Invoicing system'
  };

  const categorySpecificModules = {
    restaurant: {
      'Table Management': 'Manage tables and reservations',
      'KOT': 'Kitchen Order Tickets',
      'Kitchen Display': 'Kitchen display system',
      'Reservations': 'Table bookings'
    },
    grocery: {
      'Barcode Scanning': 'Barcode reader support',
      'Batch Tracking': 'Track batches and expiry',
      'Supplier Management': 'Manage suppliers',
      'Purchase Orders': 'PO management'
    },
    salon: {
      'Appointments': 'Schedule appointments',
      'Staff Management': 'Staff schedules',
      'Service Packages': 'Service bundles'
    },
    retail: {
      'Barcode Scanning': 'Barcode reader support',
      'Warranty Tracking': 'Product warranties'
    }
  };

  return {
    ...baseModules,
    ...(categorySpecificModules[category?.toLowerCase()] || {})
  };
}
// =========================
// Root route
// =========================
app.get("/", (req, res) => {
  res.send("✅ Server running successfully");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
