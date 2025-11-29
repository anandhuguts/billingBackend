import { supabase } from "../supabase/supabaseClient.js";

// Helper: format a Date to YYYY-MM-DD in given timezone using toLocaleDateString
function formatDateInTZ(date, tz) {
  try {
    const parts = new Date(date).toLocaleDateString("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return parts; // YYYY-MM-DD
  } catch (err) {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function startOfWeek(dateInTZ) {
  const d = new Date(dateInTZ);
  const day = d.getUTCDay(); // 0 (Sun) - 6 (Sat)
  // Treat Monday as start of week: compute offset to Monday
  const offset = (day + 6) % 7; // 0 for Mon, 6 for Sun
  const ms = d.getTime() - offset * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function periodKey(dateISO, granularity, tz) {
  if (granularity === "monthly") {
    // YYYY-MM
    const d = formatDateInTZ(dateISO, tz);
    return d.slice(0, 7);
  }
  if (granularity === "weekly") {
    // represent week by the Monday date YYYY-MM-DD
    const d = formatDateInTZ(dateISO, tz);
    return startOfWeek(d);
  }
  // default daily YYYY-MM-DD
  return formatDateInTZ(dateISO, tz);
}

/**
 * GET /api/reports/tenant
 * Query params:
 *  - start_date (YYYY-MM-DD) required
 *  - end_date (YYYY-MM-DD) required
 *  - granularity (daily|weekly|monthly) optional
 *  - tz optional (default UTC)
 *  - export=csv optional
 *  - page (int) optional - for paginated lists (default 1)
 *  - limit (int) optional - rows per page (default 10)
 */
export const getTenantReport = async (req, res) => {
  try {
    // Prefer server-side identity; do not trust tenant_id from query in production.
    const tenant_id = req.user?.tenant_id || req.query.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const {
      start_date,
      end_date,
      granularity = "daily",
      tz = "UTC",
      export: exportFormat,
    } = req.query;

    // Pagination params
    const MAX_LIMIT = 100;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    let limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    const offset = (page - 1) * limit;
    // Use explicit ISO datetimes to avoid partial-day issues and make ranges inclusive
    const rangeStart = `${start_date}T00:00:00Z`;
    const rangeEnd = `${end_date}T23:59:59Z`;

    if (!start_date || !end_date) {
      return res
        .status(400)
        .json({ error: "start_date and end_date are required (YYYY-MM-DD)" });
    }

    // 1) Fetch paginated invoices
    // Use count: 'exact' to get total rows (Supabase supports this)
    const invoicesQuery = supabase
      .from("invoices")
      .select("id, total_amount, created_at", { count: "exact" })
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false }) // latest first; change as needed
      .range(offset, offset + limit - 1);

    const {
      data: invoicesPage = [],
      count: invoicesTotal = 0,
      error: invErr,
    } = await invoicesQuery;
    if (invErr) throw invErr;

    // 2) Fetch paginated purchases
    const purchasesQuery = supabase
      .from("purchases")
      .select("id, total_amount, created_at", { count: "exact" })
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const {
      data: purchasesPage = [],
      count: purchasesTotal = 0,
      error: purErr,
    } = await purchasesQuery;
    if (purErr) throw purErr;

    // 3) Fetch paginated payments FROM invoices table (use payment_method + final_amount)
    // Some apps record payment info on invoices rather than a separate payments table.
    const paymentsQuery = supabase
      .from("invoices")
      .select("id, payment_method, final_amount, created_at", {
        count: "exact",
      })
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const {
      data: paymentsPage = [],
      count: paymentsPageTotal = 0,
      error: payErr,
    } = await paymentsQuery;
    if (payErr) throw payErr;

    // 4) Fetch paginated inventory/stock (if you store inventory in 'inventory' or 'products' table)
    // Replace table/column names as per your schema: here assuming table 'inventory' with product_name, quantity, cost_price, reorder_level
    const inventoryQuery = supabase
      .from("inventory")
      .select(
        `
        id,
        quantity,
        reorder_level,
        updated_at,
        product_id,
        expiry_date,
        max_stock,
        products (
          id,
          name,
          category,
          brand,
          unit,
          cost_price,
          selling_price,
          barcode,
          sku
        )
      `,
        { count: "exact" }
      )
      .eq("tenant_id", tenant_id)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const {
      data: stockPage = [],
      count: stockTotal = 0,
      error: invtErr,
    } = await inventoryQuery;
    if (invtErr) throw invtErr;

    // 5) For timeseries (sales + purchases) we will fetch all rows in range and aggregate in-memory as before
    // (You should prefer DB aggregation for production)
    const { data: allInvoices = [] } = await supabase
      .from("invoices")
      .select("id, total_amount, created_at")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id);

    const { data: allPurchases = [] } = await supabase
      .from("purchases")
      .select("id, total_amount, created_at")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id);

    // Aggregate payments fully to compute payment_summary (not only page) - read from invoices
    const { data: allPayments = [] } = await supabase
      .from("invoices")
      .select("id, payment_method, final_amount, total_amount, created_at")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("tenant_id", tenant_id);

    // Build timeseries
    const series = {};
    function addToSeries(item, type) {
      const key = periodKey(item.created_at, granularity, tz);
      if (!series[key])
        series[key] = {
          period: key,
          sales: 0,
          purchases: 0,
          sales_count: 0,
          purchases_count: 0,
        };
      if (type === "sales") {
        const amt = Number(item.total_amount || 0) || 0;
        series[key].sales += amt;
        series[key].sales_count += 1;
      } else {
        const amt = Number(item.total_amount || 0) || 0;
        series[key].purchases += amt;
        series[key].purchases_count += 1;
      }
    }
    (allInvoices || []).forEach((inv) => addToSeries(inv, "sales"));
    (allPurchases || []).forEach((p) => addToSeries(p, "purchases"));

    // Build ordered array between start_date and end_date
    const start = new Date(rangeStart);
    const end = new Date(rangeEnd);
    const output = [];
    const current = new Date(start);

    while (current <= end) {
      let key;
      if (granularity === "monthly") {
        const y = current.getUTCFullYear();
        const m = String(current.getUTCMonth() + 1).padStart(2, "0");
        key = `${y}-${m}`;
        current.setUTCMonth(current.getUTCMonth() + 1);
      } else if (granularity === "weekly") {
        const d = new Date(current);
        const day = d.getUTCDay();
        const offsetWeek = (day + 6) % 7;
        const monday = new Date(d.getTime() - offsetWeek * 24 * 60 * 60 * 1000);
        key = startOfWeek(formatDateInTZ(monday.toISOString(), tz));
        current.setUTCDate(current.getUTCDate() + 7);
      } else {
        key = formatDateInTZ(current.toISOString(), tz);
        current.setUTCDate(current.getUTCDate() + 1);
      }

      const val = series[key] || {
        period: key,
        sales: 0,
        purchases: 0,
        sales_count: 0,
        purchases_count: 0,
      };
      output.push({
        period: val.period,
        sales: Number(val.sales.toFixed(2)),
        purchases: Number(val.purchases.toFixed(2)),
        sales_count: val.sales_count,
        purchases_count: val.purchases_count,
      });
    }

    // Build payment summary (aggregate over allPayments)
    const paymentMap = {};
    let paymentsTotal = 0;
    (allPayments || []).forEach((p) => {
      // invoices store payment_method and may store final_amount (post-discounts). Fallback to total_amount.
      const mode = (p.payment_method || "Unknown").toString();
      const amt = Number(p.final_amount ?? p.total_amount ?? 0) || 0;
      paymentsTotal += amt;
      if (!paymentMap[mode]) paymentMap[mode] = { total: 0, count: 0 };
      paymentMap[mode].total += amt;
      paymentMap[mode].count += 1;
    });

    const paymentSummaryArray = Object.entries(paymentMap).map(
      ([mode, stats]) => {
        const share =
          paymentsTotal > 0 ? (stats.total / paymentsTotal) * 100 : 0;
        return {
          mode,
          total: Number(stats.total.toFixed(2)),
          count: stats.count,
          share: Number(share.toFixed(2)),
        };
      }
    );

    let topPaymentMode = null;
    if (paymentSummaryArray.length > 0) {
      paymentSummaryArray.sort((a, b) => b.total - a.total);
      topPaymentMode = paymentSummaryArray[0].mode;
    }

    // CSV export: include full timeseries and payment summary
    if (exportFormat === "csv") {
      const header = "period,sales,purchases,sales_count,purchases_count\n";
      const rows = output
        .map(
          (r) =>
            `${r.period},${r.sales},${r.purchases},${r.sales_count},${r.purchases_count}`
        )
        .join("\n");
      const timeseriesCsv = header + rows;

      const payHeader = "\n\nmode,total,count,share_percent\n";
      const payRows = paymentSummaryArray
        .map((p) => `${p.mode},${p.total},${p.count},${p.share}`)
        .join("\n");
      const csv = timeseriesCsv + payHeader + payRows;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=tenant-timeseries-with-payments-${start_date}_to_${end_date}.csv`
      );
      return res.send(csv);
    }

    // Build pagination metas
    const makeMeta = (total) => {
      const t = Number(total || 0);
      const totalPages = Math.max(1, Math.ceil(t / limit));
      return {
        page,
        limit,
        total: t,
        totalPages,
      };
    };

    return res.json({
      success: true,
      meta: { start_date, end_date, granularity, tz },
      timeseries: output,
      payment_summary: {
        total_amount: Number(paymentsTotal.toFixed(2)),
        modes: paymentSummaryArray,
        top_mode: topPaymentMode,
      },
      invoices_page: invoicesPage,
      invoices_meta: makeMeta(invoicesTotal),
      purchases_page: purchasesPage,
      purchases_meta: makeMeta(purchasesTotal),
      payments_page: paymentsPage,
      payments_meta: makeMeta(paymentsPageTotal),
      stock_page: stockPage,
      stock_meta: makeMeta(stockTotal),
    });
  } catch (err) {
    console.error("tenantReport error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export default { getTenantReport };
