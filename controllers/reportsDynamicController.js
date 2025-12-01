import { supabase } from "../supabase/supabaseClient.js";

/* ============================================================
   1. DAILY SUMMARY (Sales Today, Purchases Today, Profit)
=============================================================== */
export const getReportSummary = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;

    const today = new Date().toISOString().split("T")[0];

    // SALES TODAY
    const { data: salesData, error: salesErr } = await supabase
      .from("invoices")
      .select("final_amount")
      .eq("tenant_id", tenantId)
      .gte("created_at", today);

    if (salesErr) throw salesErr;

    const totalSales =
      salesData?.reduce((sum, bill) => sum + Number(bill.final_amount), 0) || 0;

    // PURCHASES TODAY
    const { data: purchaseData, error: purchaseErr } = await supabase
      .from("purchases")
      .select("total_amount")
      .eq("tenant_id", tenantId)
      .gte("created_at", today);

    if (purchaseErr) throw purchaseErr;

    const totalPurchases =
      purchaseData?.reduce((sum, p) => sum + Number(p.total_amount), 0) || 0;

    // PROFIT TODAY
    const profit = totalSales - totalPurchases;

    res.json({
      totalSales,
      totalPurchases,
      profit,
      lowStock: 0, // You can calculate from inventory if needed
      transactions: salesData?.length || 0,
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

    const { data, error } = await supabase
      .rpc("get_sales_last_7_days", { tid: tenantId });

    if (error) throw error;

    // Fallback if RPC not available
    const sales = data || [];

    res.json(sales);
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

    const { data, error } = await supabase
      .from("purchases")
      .select("total_amount, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(7);

    if (error) throw error;

    const formatted = data.map((row) => ({
      date: row.created_at.split("T")[0],
      purchase: Number(row.total_amount || 0),
    }));

    res.json(formatted.reverse());
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

    const { data, error } = await supabase
      .from("inventory")
      .select("product_id, quantity, products(name, selling_price)")
      .eq("tenant_id", tenantId);

    if (error) throw error;

    const report = data.map((item) => ({
      product: item.products?.name,
      available: Number(item.quantity),
      value: Number(item.quantity) * Number(item.products?.selling_price || 0),
      status: Number(item.quantity) < 20 ? "Low" : "Good",
    }));

    res.json(report);
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

    // Fetch sold items
    const { data: soldItems, error } = await supabase
      .from("invoice_items")
      .select("product_id, quantity, price, products(cost_price, name)")
      .eq("tenant_id", tenantId);

    if (error) throw error;

    const report = soldItems.map((item) => ({
      product: item.products?.name,
      revenue: Number(item.price) * Number(item.quantity),
      cost: Number(item.products?.cost_price || 0) * Number(item.quantity),
    }));

    res.json(report);
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

    const { data, error } = await supabase
      .from("invoices")
      .select("payment_method, final_amount")
      .eq("tenant_id", tenantId);

    if (error) throw error;

    const modes = {};

    data.forEach((bill) => {
      const method = bill.payment_method || "unknown";
      modes[method] = (modes[method] || 0) + Number(bill.final_amount || 0);
    });

    const formatted = Object.keys(modes).map((mode) => ({
      mode,
      value: modes[mode],
    }));

    res.json(formatted);
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

    // Sales
    const { data: sales, error: sErr } = await supabase
      .from("invoices")
      .select("final_amount, created_at")
      .eq("tenant_id", tenantId);

    if (sErr) throw sErr;

    // Purchases
    const { data: purchases, error: pErr } = await supabase
      .from("purchases")
      .select("total_amount, created_at")
      .eq("tenant_id", tenantId);

    if (pErr) throw pErr;

    const chart = [];

    sales.forEach((s) => {
      chart.push({
        date: s.created_at.split("T")[0],
        sales: Number(s.final_amount || 0),
        purchase: 0,
      });
    });

    purchases.forEach((p) => {
      chart.push({
        date: p.created_at.split("T")[0],
        sales: 0,
        purchase: Number(p.total_amount || 0),
      });
    });

    // Combine by date
    const merged = {};

    chart.forEach((row) => {
      if (!merged[row.date]) merged[row.date] = { date: row.date, sales: 0, purchase: 0 };
      merged[row.date].sales += row.sales;
      merged[row.date].purchase += row.purchase;
    });

    res.json(Object.values(merged).sort((a, b) => new Date(a.date) - new Date(b.date)));
  } catch (err) {
    console.error("Analytics error:", err.message);
    res.status(500).json({ error: "Failed to load analytics" });
  }
};
