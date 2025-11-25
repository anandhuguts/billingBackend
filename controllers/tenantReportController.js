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

export const getTenantReport = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id || req.query.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const {
      start_date,
      end_date,
      granularity = "daily",
      tz = "UTC",
      export: exportFormat,
    } = req.query;

    if (!start_date || !end_date) {
      return res
        .status(400)
        .json({ error: "start_date and end_date are required (YYYY-MM-DD)" });
    }

    // fetch invoices (sales) in range
    const { data: invoices = [], error: invErr } = await supabase
      .from("invoices")
      .select("id, total_amount, created_at")
      .gte("created_at", start_date)
      .lte("created_at", end_date + "T23:59:59Z")
      .eq("tenant_id", tenant_id);

    if (invErr) throw invErr;

    // fetch purchases in range
    const { data: purchases = [], error: purErr } = await supabase
      .from("purchases")
      .select("id, total_amount, created_at")
      .gte("created_at", start_date)
      .lte("created_at", end_date + "T23:59:59Z")
      .eq("tenant_id", tenant_id);

    if (purErr) throw purErr;

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
        const amt = parseFloat(item.total_amount || 0) || 0;
        series[key].sales += amt;
        series[key].sales_count += 1;
      } else {
        const amt = parseFloat(item.total_amount || 0) || 0;
        series[key].purchases += amt;
        series[key].purchases_count += 1;
      }
    }

    invoices.forEach((inv) => addToSeries(inv, "sales"));
    purchases.forEach((p) => addToSeries(p, "purchases"));

    // produce ordered array between start_date and end_date
    const start = new Date(start_date);
    const end = new Date(end_date);
    const output = [];
    const current = new Date(start);

    while (current <= end) {
      let key;
      if (granularity === "monthly") {
        const y = current.getUTCFullYear();
        const m = String(current.getUTCMonth() + 1).padStart(2, "0");
        key = `${y}-${m}`;
        // move to next month
        current.setUTCMonth(current.getUTCMonth() + 1);
      } else if (granularity === "weekly") {
        // for weekly, use Monday as start; ensure we iterate by weeks
        // find Monday of current
        const d = new Date(current);
        const day = d.getUTCDay();
        const offset = (day + 6) % 7; // days since Monday
        const monday = new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
        key = startOfWeek(formatDateInTZ(monday.toISOString(), tz));
        current.setUTCDate(current.getUTCDate() + 7);
      } else {
        // daily
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

    if (exportFormat === "csv") {
      // simple CSV response
      const header = "period,sales,purchases,sales_count,purchases_count\n";
      const rows = output
        .map(
          (r) =>
            `${r.period},${r.sales},${r.purchases},${r.sales_count},${r.purchases_count}`
        )
        .join("\n");
      const csv = header + rows;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=tenant-timeseries-${start_date}_to_${end_date}.csv`
      );
      return res.send(csv);
    }

    return res.json({
      success: true,
      meta: { start_date, end_date, granularity, tz },
      timeseries: output,
    });
  } catch (err) {
    console.error("tenantReport error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

export default { getTenantReport };
