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
  const last = await supabase
    .from("ledger_entries")
    .select("balance")
    .eq("tenant_id", tenant_id)
    .eq("account_id", account_id)
    .order("id", { ascending: false })
    .limit(1);

  const prevBalance = last.data?.[0]?.balance || 0;

  const newBalance =
    entry_type === "debit" ? prevBalance + amount : prevBalance - amount;

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
      const { employee_id, month, salary_amount, deductions = 0, bonuses = 0, payment_method } = req.body;

      if (!employee_id || !month || !salary_amount || !payment_method) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // PREVENT duplicate salary for same employee/month
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

      const net_salary = Number(salary_amount) + Number(bonuses) - Number(deductions);

      // SAVE salary record first
      const { data: salaryRows, error: salaryErr } = await supabase
        .from("employee_salary_payments")
        .insert([
          {
            tenant_id,
            employee_id,
            month,
            salary_amount,
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
        GET REQUIRED ACCOUNT IDs
      ------------------------------------------------------------ */
      const { data: coa, error: coaErr } = await supabase
        .from("coa")
        .select("id, name, type")
        .eq("tenant_id", tenant_id);

      if (coaErr || !coa.length) throw new Error("COA missing");

      const salaryExpense = coa.find((a) => a.name === "Salary Expense");
      const cashAccount = coa.find((a) => a.name === (payment_method === "bank" ? "Bank" : "Cash"));

      if (!salaryExpense) throw new Error("Salary Expense account missing");
      if (!cashAccount) throw new Error("Cash/Bank account missing");

      const description = `Salary payment for ${month}`;

      /* ------------------------------------------------------------
        JOURNAL ENTRY
        Debit  Salary Expense
        Credit Cash/Bank
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
        LEDGER ENTRIES
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
        DAYBOOK ENTRY
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

  /* GET salary for one employee */
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

  /* GET all salary history */
  async getAll(req, res) {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("employee_salary_payments")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("month", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true, data });
  }
};
