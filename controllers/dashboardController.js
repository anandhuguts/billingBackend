import { supabase } from "../supabase/supabaseClient.js";

export const getDashboardStats = async (req, res) => {
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
};


