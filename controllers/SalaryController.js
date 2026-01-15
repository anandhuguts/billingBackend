// controllers/SalaryController.js
import { supabase } from "../supabase/supabaseClient.js";
import { addJournalEntry } from "../services/addJournalEntryService.js";

/* ============================================================
   HELPER: Get COA Accounts
============================================================ */
async function getCoaMap(tenant_id) {
  const { data, error } = await supabase
    .from("coa")
    .select("id, name, type")
    .eq("tenant_id", tenant_id);

  if (error) throw error;

  const map = {};
  data?.forEach((acc) => {
    map[acc.name.toLowerCase()] = acc.id;
  });
  return map;
}

function coaId(map, name) {
  const id = map[name.toLowerCase()];
  if (!id) throw new Error(`COA missing: ${name}`);
  return id;
}

/* ============================================================
   MAIN CONTROLLER
============================================================ */
export const SalaryController = {

  /* ------------------------------------------------------------
     PAY SALARY
  ------------------------------------------------------------ */
  async paySalary(req, res) {
    console.log(req.body);
    try {
      const tenant_id = req.user.tenant_id;
      const { employee_id, month, deductions = 0, bonuses = 0, payment_method } = req.body;

      /* ------------------------------------------------------------
          1️⃣ Validate required fields
      ------------------------------------------------------------ */
      if (!employee_id || !month || !payment_method) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      /* ------------------------------------------------------------
          2️⃣ Validate month format YYYY-MM
      ------------------------------------------------------------ */
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Month must be in YYYY-MM format (Example: 2025-01)" });
      }

      /* Prevent paying salary for future months */
      const salaryDate = new Date(`${month}-01`);
      const now = new Date();
      if (salaryDate > now) {
        return res.status(400).json({ error: "Cannot pay salary for a future month" });
      }

      /* ------------------------------------------------------------
         3️⃣ Validate employee exists
      ------------------------------------------------------------ */
      const { data: emp, error: empErr } = await supabase
        .from("employees")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("id", employee_id)
        .single();

      if (empErr || !emp) {
        return res.status(400).json({ error: "Employee not found" });
      }

      /* ------------------------------------------------------------
         4️⃣ Fetch salary from employee_salary_master (OPTIONAL)
      ------------------------------------------------------------ */
      const { data: master } = await supabase
        .from("employee_salary_master")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .maybeSingle();

      // Use master if exists, otherwise require manual salary_amount
      let baseSalary, defaultAllowance, defaultDeduction;

      if (master) {
        // Use predefined salary structure
        baseSalary = Number(master.monthly_salary);
        defaultAllowance = Number(master.allowance || 0);
        defaultDeduction = Number(master.deduction || 0);
      } else {
        // No master record - require manual salary_amount
        const { salary_amount } = req.body;

        if (!salary_amount || Number(salary_amount) <= 0) {
          return res.status(400).json({
            error: "No salary structure found. Please provide salary_amount in request body."
          });
        }

        baseSalary = Number(salary_amount);
        defaultAllowance = 0;
        defaultDeduction = 0;
      }

      const net_salary =
        baseSalary + defaultAllowance + Number(bonuses || 0) - defaultDeduction - Number(deductions || 0);

      /* ------------------------------------------------------------
         5️⃣ Prevent duplicate salary for same month
      ------------------------------------------------------------ */
      const { data: existing } = await supabase
        .from("employee_salary_payments")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .eq("month", month)
        .limit(1);

      if (existing?.length > 0) {
        return res.status(400).json({ error: `Salary already paid for ${month}` });
      }

      /* ------------------------------------------------------------
         6️⃣ Insert salary payment record
      ------------------------------------------------------------ */
      const { data: salaryRows, error: salaryErr } = await supabase
        .from("employee_salary_payments")
        .insert([
          {
            tenant_id,
            employee_id,
            month,
            salary_amount: baseSalary,
            deductions,
            bonuses,
            net_salary,
            payment_method,
          },
        ])
        .select();

      if (salaryErr) throw salaryErr;

      const salaryRecord = salaryRows[0];

      /* ------------------------------------------------------------
         7️⃣ Get COA accounts (case-insensitive)
      ------------------------------------------------------------ */
      const coaMap = await getCoaMap(tenant_id);
      const description = `Salary paid to ${emp.name || 'employee'} for ${month}`;

      /* ------------------------------------------------------------
         8️⃣ ✅ FIXED: Proper Journal Entry using service
         DR Salary Expense
         CR Cash/Bank
      ------------------------------------------------------------ */
      const paymentAccountName = payment_method === "bank" ? "bank" : "cash";

      await addJournalEntry({
        tenant_id,
        debit_account: coaId(coaMap, "salary expense"),
        credit_account: coaId(coaMap, paymentAccountName),
        amount: net_salary,
        description,
        reference_id: salaryRecord.id,
        reference_type: "salary"
      });

      /* ------------------------------------------------------------
         9️⃣ ✅ FIXED: Daybook Entry (money OUT = credit)
      ------------------------------------------------------------ */
      await supabase.from("daybook").insert([
        {
          tenant_id,
          entry_type: "salary",
          description,
          debit: 0,
          credit: net_salary,  // ✅ Money going out
          reference_id: salaryRecord.id,
        },
      ]);

      return res.json({ success: true, message: "Salary paid successfully", data: salaryRecord });

    } catch (err) {
      console.error("Salary pay error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  /* ------------------------------------------------------------
     GET salary for one employee
  ------------------------------------------------------------ */
  async getEmployeeSalary(req, res) {
    const { employee_id } = req.params;
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("employee_salary_payments")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("employee_id", employee_id)
      .order("month", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true, data });
  },

  /* ------------------------------------------------------------
     GET all salary payments
  ------------------------------------------------------------ */
  async getAll(req, res) {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("employee_salary_payments")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("month", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true, data });
  },

  /* ------------------------------------------------------------
     CHECK if salary paid for a month
  ------------------------------------------------------------ */
  async checkSalaryPaid(req, res) {
    const tenant_id = req.user.tenant_id;
    const { employee_id } = req.params;
    const { month } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Month must be YYYY-MM format" });
    }

    const { data, error } = await supabase
      .from("employee_salary_payments")
      .select("id, net_salary, created_at")
      .eq("tenant_id", tenant_id)
      .eq("employee_id", employee_id)
      .eq("month", month)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = row not found (that's okay)
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.json({
        paid: false,
        message: `Salary NOT paid for ${month}`
      });
    }

    return res.json({
      paid: true,
      message: `Salary already paid for ${month}`,
      record: data
    });
  }

};
