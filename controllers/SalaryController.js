// controllers/SalaryController.js
import { supabase } from "../supabase/supabaseClient.js";

/* ============================================================
   HELPER: Add Journal Entry (Double Entry)
============================================================ */
async function addJournalEntry({ tenant_id, debit_account, credit_account, amount, description, reference_id }) {
  const { error } = await supabase.from("journal_entries").insert([
    {
      tenant_id,
      debit_account,
      credit_account,
      amount,
      description,
      reference_type: "salary",
      reference_id,
      created_at: new Date(),
    },
  ]);

  if (error) throw error;
}

/* ============================================================
   HELPER: Insert Ledger Entry with running balance
============================================================ */
async function insertLedgerEntry({ tenant_id, account_id, account_type, entry_type, amount, description, reference_id }) {
  const { data: lastRows } = await supabase
    .from("ledger_entries")
    .select("balance")
    .eq("tenant_id", tenant_id)
    .eq("account_id", account_id)
    .eq("account_type", account_type)
    .order("id", { ascending: false })
    .limit(1);

  const prevBalance = lastRows?.[0]?.balance || 0;
  const newBalance = entry_type === "debit" ? prevBalance + amount : prevBalance - amount;

  const { error } = await supabase.from("ledger_entries").insert([
    {
      tenant_id,
      account_id,
      account_type,
      entry_type,
      debit: entry_type === "debit" ? amount : 0,
      credit: entry_type === "credit" ? amount : 0,
      balance: newBalance,
      description,
      reference_type: "salary",
      reference_id,
      created_at: new Date(),
    },
  ]);

  if (error) throw error;
}

/* ============================================================
   MAIN CONTROLLER
============================================================ */
export const SalaryController = {

  /* ------------------------------------------------------------
     PAY SALARY
  ------------------------------------------------------------ */
  async paySalary(req, res) {
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
         4️⃣ Fetch salary from employee_salary_master
      ------------------------------------------------------------ */
      const { data: master, error: masterErr } = await supabase
        .from("employee_salary_master")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .single();

      if (masterErr || !master) {
        return res.status(400).json({ error: "Salary structure not found for employee" });
      }

      const baseSalary = Number(master.monthly_salary);
      const defaultAllowance = Number(master.allowance || 0);
      const defaultDeduction = Number(master.deduction || 0);

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
         7️⃣ Get COA accounts
      ------------------------------------------------------------ */
      const { data: coa } = await supabase
        .from("coa")
        .select("id, name, type")
        .eq("tenant_id", tenant_id);

      const salaryExpense = coa.find(a => a.name === "Salary Expense");
      const cashAccount = coa.find(a => a.name === (payment_method === "bank" ? "Bank" : "Cash"));

      if (!salaryExpense) throw new Error("Salary Expense COA missing");
      if (!cashAccount) throw new Error("Cash/Bank COA missing");

      const description = `Salary paid for ${month}`;

      /* ------------------------------------------------------------
         8️⃣ Journal Entry
         DR Salary Expense
         CR Cash/Bank
      ------------------------------------------------------------ */
      await addJournalEntry({
        tenant_id,
        debit_account: salaryExpense.id,
        credit_account: cashAccount.id,
        amount: net_salary,
        description,
        reference_id: salaryRecord.id
      });

      /* ------------------------------------------------------------
         9️⃣ Ledger Entries
      ------------------------------------------------------------ */
      await insertLedgerEntry({
        tenant_id,
        account_id: salaryExpense.id,
        account_type: "expense",
        entry_type: "debit",
        amount: net_salary,
        description,
        reference_id: salaryRecord.id
      });

      await insertLedgerEntry({
        tenant_id,
        account_id: cashAccount.id,
        account_type: "asset",
        entry_type: "credit",
        amount: net_salary,
        description,
        reference_id: salaryRecord.id
      });

      /* ------------------------------------------------------------
         🔟 Daybook Entry
      ------------------------------------------------------------ */
      await supabase.from("daybook").insert([
        {
          tenant_id,
          entry_type: "salary",
          description,
          debit: net_salary,
          credit: 0,
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

