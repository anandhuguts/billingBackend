import { supabase } from "../supabase/supabaseClient.js";

/* ============================================================
   1. DAILY SUMMARY (Sales Today, Purchases Today, Profit)
=============================================================== */
export const getReportSummary = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    let p_from = null;
    let p_to = null;

    const today = new Date();

    // 🔹 RANGE HANDLING
    if (req.query.range === "7d") {
      const from = new Date();
      from.setDate(today.getDate() - 6);

      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    if (req.query.range === "30d") {
      const from = new Date();
      from.setDate(today.getDate() - 29);

      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    // 🔹 CUSTOM DATE RANGE
    if (req.query.from && req.query.to) {
      p_from = req.query.from;
      p_to = req.query.to;
    }

    const { data, error } = await supabase.rpc("get_summary", {
      p_tenant: tenantId,
      p_from,
      p_to
    });

    if (error) throw error;

    const summary = data[0];

    res.json({
      totalSales: Number(summary.total_sales || 0),
      totalPurchases: Number(summary.total_purchases || 0),
      profit:
        Number(summary.total_sales || 0) -
        Number(summary.total_purchases || 0),
      lowStock: 0,
      transactions: summary.transactions || 0,
    });
  } catch (err) {
    console.error("Summary error:", err.message);
    res.status(500).json({ error: "Failed to load summary" });
  }
};




/* ============================================================
   2. SALES CHART (Last 7 Days)
=============================================================== */
export const getSalesChart = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    // ✅ MAP range → number of days
    let days = 7; // default

    if (req.query.range === "30d") days = 30;
    if (req.query.range === "7d") days = 7;

    const { data, error } = await supabase
      .rpc("get_sales_chart", {
        p_tenant: tenantId,
        p_days: days
      });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Sales Chart Error:", err.message);
    res.status(500).json({ error: "Failed to load sales graph" });
  }
};



/* ============================================================
   3. PURCHASE CHART (Last 7 Days)
=============================================================== */
export const getPurchaseChart = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    let days = 7;
    if (req.query.range === "30d") days = 30;
    if (req.query.range === "7d") days = 7;

    const { data, error } = await supabase
      .rpc("get_purchase_chart", {
        p_tenant: tenantId,
        p_days: days
      });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Purchase Chart Error:", err.message);
    res.status(500).json({ error: "Failed to load purchase graph" });
  }
};


/* ============================================================
   4. STOCK REPORT (Inventory Overview)
=============================================================== */
export const getStockReport = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    const { data, error } = await supabase
      .rpc("get_stock_report", { p_tenant: tenantId });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Stock Error:", err.message);
    res.status(500).json({ error: "Failed to load stock report" });
  }
};


/* ============================================================
   5. PROFIT REPORT (Revenue - Cost per Product)
=============================================================== */
export const getProfitReport = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    let p_from = null;
    let p_to = null;

    const today = new Date();

    if (req.query.range === "7d") {
      const from = new Date();
      from.setDate(today.getDate() - 6);
      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    if (req.query.range === "30d") {
      const from = new Date();
      from.setDate(today.getDate() - 29);
      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    if (req.query.from && req.query.to) {
      p_from = req.query.from;
      p_to = req.query.to;
    }

    const { data, error } = await supabase.rpc("get_profit_report", {
      p_tenant: tenantId,
      p_from,
      p_to
    });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Profit report error:", err.message);
    res.status(500).json({ error: "Failed to load profit report" });
  }
};

/* ============================================================
   6. PAYMENT SUMMARY (Cash, UPI, Card, Credit)
=============================================================== */
export const getPaymentSummary = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    let p_from = null;
    let p_to = null;

    const today = new Date();

    // 🔹 range handling
    if (req.query.range === "7d") {
      const from = new Date();
      from.setDate(today.getDate() - 6);
      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    if (req.query.range === "30d") {
      const from = new Date();
      from.setDate(today.getDate() - 29);
      p_from = from.toISOString().split("T")[0];
      p_to = today.toISOString().split("T")[0];
    }

    if (req.query.from && req.query.to) {
      p_from = req.query.from;
      p_to = req.query.to;
    }

    const { data, error } = await supabase.rpc("get_payment_summary", {
      p_tenant: tenantId,
      p_from,
      p_to
    });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Payment Summary Error:", err.message);
    res.status(500).json({ error: "Failed to load payment summary" });
  }
};

/* ============================================================
   7. OVERALL ANALYTICS (Sales vs Purchases)
=============================================================== */
export const getAnalyticsReport = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId)
      return res.status(403).json({ error: "Unauthorized" });

    let days = 7;
    if (req.query.range === "30d") days = 30;
    if (req.query.range === "7d") days = 7;

    const { data, error } = await supabase
      .rpc("get_analytics_chart", {
        p_tenant: tenantId,
        p_days: days
      });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Analytics error:", err.message);
    res.status(500).json({ error: "Failed to load analytics" });
  }
};

