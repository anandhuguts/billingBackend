// controllers/reportController.js
import { createClient } from "@supabase/supabase-js";
import ejs from "ejs";
import puppeteer from "puppeteer";
import path from "path";
import { supabase as anonSupabase } from "../supabase/supabaseClient.js";

// Initialize Supabase client for server use. Prefer the SERVICE_ROLE key if provided,
// otherwise fall back to the shared client (which uses SUPABASE_KEY). Using the
// service role requires storing the service key securely in the environment.
let supabase;
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  supabase = createClient(supabaseUrl, serviceKey);
  console.log("Using Supabase service-role key for report generation");
} else {
  supabase = anonSupabase;
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY not found — falling back to anon client. RLS may block some queries."
  );
}

// Helper: fetch all tables you want to include
async function fetchAllData() {
  // Example: fetch from tenants, users, payments
  const { data: tenants } = await supabase.from("tenants").select("*");
  const { data: users } = await supabase.from("users").select("*");
  const { data: payments } = await supabase.from("payments").select("*");
  // Add more tables as needed
  // Return enriched data so templates receive normalized fields
  return enrichData(tenants || [], users || [], payments || []);
}

export const generatePdfReport = async (req, res) => {
  try {
    // 1) Fetch data
    const allData = await fetchAllData();

    // 2) Render HTML using an EJS template
    // Template located under controllers/templates/fullReport.ejs
    const templatePath = path.join(
      process.cwd(),
      "controllers",
      "templates",
      "fullReport.ejs"
    );
    const html = await ejs.renderFile(templatePath, {
      data: allData,
      generatedAt: new Date().toLocaleString(),
      title: "Full Database Report",
    });

    // 3) Launch Puppeteer to convert HTML to PDF
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Set HTML content (base tag might be needed if you use relative assets)
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Optional: Emulate print CSS media
    await page.emulateMediaType("print");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: false, // set true and headerTemplate/footerTemplate for custom header/footer
    });

    await browser.close();

    // 4) Send PDF to client
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="full-report-${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF generation error:", err);
    return res.status(500).json({ error: "Failed to generate report" });
  }
};

// Enrich tenants/users/payments with normalized fields for templates
function enrichData(tenants = [], users = [], payments = []) {
  const usersEnriched = (users || []).map((u) => ({
    ...u,
    username: u.username || u.name || u.full_name || u.email || null,
  }));

  const usersByTenant = (usersEnriched || []).reduce((acc, u) => {
    if (u.tenant_id) acc[u.tenant_id] = u;
    return acc;
  }, {});

  const tenantsById = (tenants || []).reduce((acc, t) => {
    if (t.id) acc[t.id] = t;
    return acc;
  }, {});

  const paymentsEnriched = (payments || []).map((p) => {
    const user = usersByTenant[p.tenant_id] || null;
    return {
      ...p,
      paid_at: p.payment_date || p.paid_at || p.paidAt || p.created_at || null,
      username:
        (user &&
          (user.full_name || user.username || user.name || user.email)) ||
        null,
      tenantName:
        (tenantsById[p.tenant_id] && tenantsById[p.tenant_id].name) || null,
      ref: p.transaction_id || p.ref || p.id || null,
    };
  });

  return { tenants, users: usersEnriched, payments: paymentsEnriched };
}

// Generate a PDF report for a single tenant (includes tenant, its users, and its payments)
export const generatePdfForTenant = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", id)
      .single();
    if (tenantError || !tenant)
      return res.status(404).json({ error: "Tenant not found" });

    const { data: users } = await supabase
      .from("users")
      .select("*")
      .eq("tenant_id", id);
    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("tenant_id", id);

    const allData = enrichData([tenant], users || [], payments || []);

    const templatePath = path.join(
      process.cwd(),
      "controllers",
      "templates",
      "fullReport.ejs"
    );
    const html = await ejs.renderFile(templatePath, {
      data: allData,
      generatedAt: new Date().toLocaleString(),
      title: `Tenant Report - ${tenant.name || tenant.id}`,
    });

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tenant-report-${id}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("generatePdfForTenant error:", err);
    return res.status(500).json({ error: "Failed to generate tenant report" });
  }
};

// Generate a PDF report for a single user (includes the user, their tenant, and tenant payments)
export const generatePdfForUser = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();
    if (userError || !user)
      return res.status(404).json({ error: "User not found" });

    const tenantId = user.tenant_id;
    const tenantRes = tenantId
      ? await supabase.from("tenants").select("*").eq("id", tenantId).single()
      : { data: null };
    const tenant = tenantRes.data || null;
    const { data: payments } = tenantId
      ? await supabase.from("payments").select("*").eq("tenant_id", tenantId)
      : { data: [] };

    const allData = enrichData(tenant ? [tenant] : [], [user], payments || []);

    const templatePath = path.join(
      process.cwd(),
      "controllers",
      "templates",
      "fullReport.ejs"
    );
    const html = await ejs.renderFile(templatePath, {
      data: allData,
      generatedAt: new Date().toLocaleString(),
      title: `User Report - ${
        user.username || user.full_name || user.email || user.id
      }`,
    });

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="user-report-${id}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("generatePdfForUser error:", err);
    return res.status(500).json({ error: "Failed to generate user report" });
  }
};

// Generate a PDF report for a single payment (includes payment and linked tenant/user)
export const generatePdfForPayment = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();
    if (paymentError || !payment)
      return res.status(404).json({ error: "Payment not found" });

    const tenantId = payment.tenant_id;
    const tenantRes = tenantId
      ? await supabase.from("tenants").select("*").eq("id", tenantId).single()
      : { data: null };
    const tenant = tenantRes.data || null;
    const { data: users } = tenantId
      ? await supabase.from("users").select("*").eq("tenant_id", tenantId)
      : { data: [] };

    const allData = enrichData(tenant ? [tenant] : [], users || [], [payment]);

    const templatePath = path.join(
      process.cwd(),
      "controllers",
      "templates",
      "fullReport.ejs"
    );
    const html = await ejs.renderFile(templatePath, {
      data: allData,
      generatedAt: new Date().toLocaleString(),
      title: `Payment Report - ${payment.id}`,
    });

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payment-report-${id}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("generatePdfForPayment error:", err);
    return res.status(500).json({ error: "Failed to generate payment report" });
  }
};

// Export CSV based on query parameters, e.g. /reports/export?type=csv&report=tenants
export const exportReport = async (req, res) => {
  try {
    const { type, report } = req.query;

    // Normalize type and report
    const t = (type || "csv").toString().toLowerCase();
    const r = (report || "").toString().toLowerCase();

    // Helper to convert array of objects to CSV string
    const toCsv = (rows = []) => {
      if (!rows || !rows.length) return "";
      const keys = Object.keys(rows[0]);
      const escape = (v) => {
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
      };
      const header = keys.map((k) => `"${k}"`).join(",");
      const body = rows
        .map((r) => keys.map((k) => escape(r[k])).join(","))
        .join("\n");
      return `${header}\n${body}`;
    };

    // If PDF requested, generate PDF using same template as full report
    if (t === "pdf") {
      // Prepare data depending on requested report
      let tenants = [];
      let users = [];
      let payments = [];
      let title = `Report - ${r || "data"}`;

      switch (r) {
        case "tenants": {
          tenants = (await supabase.from("tenants").select("*")).data || [];
          // Compute summed amount per tenant from payments and attach to tenant objects
          try {
            const tenantIds = tenants.map((t) => t.id).filter(Boolean);
            if (tenantIds.length) {
              const { data: paymentsForTenants } = await supabase
                .from("payments")
                .select("tenant_id,amount")
                .in("tenant_id", tenantIds);
              const sums = (paymentsForTenants || []).reduce((acc, p) => {
                const id = p.tenant_id;
                acc[id] = (acc[id] || 0) + (Number(p.amount) || 0);
                return acc;
              }, {});
              tenants = tenants.map((t) => ({ ...t, amount: sums[t.id] || 0 }));
            } else {
              tenants = tenants.map((t) => ({ ...t, amount: 0 }));
            }
          } catch (e) {
            console.warn("Failed to compute tenant amounts:", e);
            // leave tenants as-is (amount may be undefined)
          }
          title = "Tenants Report";
          break;
        }
        case "users": {
          users = (await supabase.from("users").select("*")).data || [];
          title = "Users Report";
          break;
        }
        case "payments": {
          payments = (await supabase.from("payments").select("*")).data || [];
          // Enrich payments rows
          payments = enrichData([], [], payments).payments || [];
          title = "Payments Report";
          break;
        }
        case "all-data": {
          tenants = (await supabase.from("tenants").select("*")).data || [];
          users = (await supabase.from("users").select("*")).data || [];
          payments = (await supabase.from("payments").select("*")).data || [];
          // Enrich payments
          payments = enrichData(tenants, users, payments).payments || [];
          // Also attach summed amount to each tenant for reporting
          try {
            const tenantIds = tenants.map((t) => t.id).filter(Boolean);
            if (tenantIds.length) {
              const { data: paymentsForTenants } = await supabase
                .from("payments")
                .select("tenant_id,amount")
                .in("tenant_id", tenantIds);
              const sums = (paymentsForTenants || []).reduce((acc, p) => {
                const id = p.tenant_id;
                acc[id] = (acc[id] || 0) + (Number(p.amount) || 0);
                return acc;
              }, {});
              tenants = tenants.map((t) => ({ ...t, amount: sums[t.id] || 0 }));
            } else {
              tenants = tenants.map((t) => ({ ...t, amount: 0 }));
            }
          } catch (e) {
            console.warn("Failed to compute tenant amounts for all-data:", e);
          }
          title = "Full Database Report";
          break;
        }
        default:
          return res.status(400).json({ error: "Unknown report type for PDF" });
      }

      // Render the same EJS template
      const templatePath = path.join(
        process.cwd(),
        "controllers",
        "templates",
        "fullReport.ejs"
      );

      const allData = { tenants, users, payments };

      const html = await ejs.renderFile(templatePath, {
        data: allData,
        generatedAt: new Date().toLocaleString(),
        title,
      });

      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.emulateMediaType("print");
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      });
      await browser.close();

      const filename = `${r || "report"}-${Date.now()}.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length,
      });
      return res.send(pdfBuffer);
    }

    // Default CSV behavior (t === 'csv')
    if (t !== "csv")
      return res.status(400).json({ error: "Unsupported export type" });

    let rows = [];
    let filename = `export-${r || "data"}-${Date.now()}.csv`;

    switch (r) {
      case "tenants": {
        const { data } = await supabase.from("tenants").select("*");
        rows = data || [];
        break;
      }
      case "users": {
        const { data } = await supabase.from("users").select("*");
        rows = data || [];
        break;
      }
      case "payments": {
        const { data } = await supabase.from("payments").select("*");
        const enriched = enrichData([], [], data || []).payments;
        rows = enriched || [];
        break;
      }
      case "revenue": {
        const { data } = await supabase
          .from("payments")
          .select("payment_date,amount");
        const map = {};
        (data || []).forEach((p) => {
          const d = new Date(
            p.payment_date || p.paid_at || p.created_at || Date.now()
          );
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            "0"
          )}`;
          map[key] = (map[key] || 0) + Number(p.amount || 0);
        });
        rows = Object.keys(map)
          .sort()
          .map((k) => ({ period: k, revenue: map[k] }));
        filename = `revenue-${Date.now()}.csv`;
        break;
      }
      case "all-data": {
        const tenants = (await supabase.from("tenants").select("*")).data || [];
        const users = (await supabase.from("users").select("*")).data || [];
        const payments =
          (await supabase.from("payments").select("*")).data || [];
        rows = [];
        tenants.forEach((t) => rows.push({ type: "tenant", ...t }));
        users.forEach((u) => rows.push({ type: "user", ...u }));
        payments.forEach((p) => rows.push({ type: "payment", ...p }));
        break;
      }
      default:
        return res.status(400).json({ error: "Unknown report type" });
    }

    const csv = toCsv(rows || []);
    res.set({
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": Buffer.byteLength(csv, "utf8"),
    });
    return res.send(csv);
  } catch (err) {
    console.error("CSV/PDF export error:", err);
    return res.status(500).json({ error: "Failed to export report" });
  }
};
