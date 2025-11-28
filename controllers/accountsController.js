import { supabase } from "../supabase/supabaseClient.js";

/* -----------------------------------------
   1. DAYBOOK
------------------------------------------ */
export const getDaybook = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("daybook")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false }); // or "date" if your column is named that

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    console.error("getDaybook error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   2. LEDGER (from ledger_entries)
------------------------------------------ */
export const getLedger = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("ledger_entries")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    console.error("getLedger error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   3. TRIAL BALANCE (from journal_entries + COA)
------------------------------------------ */
export const getTrialBalance = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // 1️⃣ Fetch all accounts for this tenant
    const { data: accounts, error: accErr } = await supabase
      .from("coa")
      .select("id, name, type")
      .eq("tenant_id", tenant_id);

    if (accErr) throw accErr;

    if (!accounts || accounts.length === 0) {
      return res.json({
        success: true,
        trial_balance: [],
        totals: { total_debit: 0, total_credit: 0, difference: 0 },
      });
    }

    const accountIds = accounts.map((a) => a.id);

    // 2️⃣ Fetch all journal entries for this tenant
    const { data: entries, error: entErr } = await supabase
      .from("journal_entries")
      .select("debit_account, credit_account, amount")
      .eq("tenant_id", tenant_id);

    if (entErr) throw entErr;

    // 3️⃣ Prepare TB map: one row per account
    const tb = {};
    accounts.forEach((a) => {
      tb[a.id] = { name: a.name, type: a.type, debit: 0, credit: 0 };
    });

    // 4️⃣ Accumulate debits & credits per account
    (entries || []).forEach((e) => {
      const amt = Number(e.amount || 0);

      if (tb[e.debit_account]) {
        tb[e.debit_account].debit += amt;
      }
      if (tb[e.credit_account]) {
        tb[e.credit_account].credit += amt;
      }
    });

    // 5️⃣ Build final array + totals
    let totalDebit = 0;
    let totalCredit = 0;

    const trial_balance = Object.entries(tb).map(([id, row]) => {
      const debit = Number(row.debit.toFixed(2));
      const credit = Number(row.credit.toFixed(2));

      totalDebit += debit;
      totalCredit += credit;

      return {
        account_id: Number(id),
        name: row.name,
        type: row.type,
        debit,
        credit,
        balance: Number((debit - credit).toFixed(2)),
      };
    });

    const difference = Number((totalDebit - totalCredit).toFixed(2));

    return res.json({
      success: true,
      trial_balance,
      totals: {
        total_debit: Number(totalDebit.toFixed(2)),
        total_credit: Number(totalCredit.toFixed(2)),
        difference,
      },
    });
  } catch (err) {
    console.error("getTrialBalance error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   4. BALANCE SHEET  (Assets / Liabilities / Equity)
------------------------------------------ */
export const getBalanceSheet = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // 1️⃣ Fetch only balance-sheet accounts
    const { data: accounts, error: accErr } = await supabase
      .from("coa")
      .select("id, name, type")
      .eq("tenant_id", tenant_id)
      .in("type", ["asset", "liability", "equity"]);

    if (accErr) throw accErr;

    if (!accounts || accounts.length === 0) {
      return res.json({
        success: true,
        assets: {},
        liabilities: {},
        equity: {},
        totals: { assetTotal: 0, liabilityTotal: 0, equityTotal: 0 },
        balanceCheck: 0,
      });
    }

    const accountIds = accounts.map((a) => a.id);

    // 2️⃣ Fetch journal entries touching those accounts
    let entries = [];
    if (accountIds.length > 0) {
      const idList = accountIds.join(",");
      const { data, error: entErr } = await supabase
        .from("journal_entries")
        .select("debit_account, credit_account, amount")
        .eq("tenant_id", tenant_id)
        .or(`debit_account.in.(${idList}),credit_account.in.(${idList})`);

      if (entErr) throw entErr;
      entries = data || [];
    }

    // 3️⃣ Initialize balances per account
    const bs = {};
    accounts.forEach((a) => {
      bs[a.id] = {
        account_id: a.id,
        name: a.name,
        type: a.type,
        debit: 0,
        credit: 0,
      };
    });

    // 4️⃣ Sum debits & credits
    entries.forEach((e) => {
      const amt = Number(e.amount || 0);

      if (bs[e.debit_account]) {
        bs[e.debit_account].debit += amt;
      }
      if (bs[e.credit_account]) {
        bs[e.credit_account].credit += amt;
      }
    });

    // 5️⃣ Compute final balances grouped by type
    const assets = {};
    const liabilities = {};
    const equity = {};

    let assetTotal = 0;
    let liabilityTotal = 0;
    let equityTotal = 0;

    Object.values(bs).forEach((acc) => {
      let balance = 0;

      if (acc.type === "asset") {
        balance = acc.debit - acc.credit; // normal debit balance
        if (balance !== 0) assets[acc.name] = Number(balance.toFixed(2));
        assetTotal += balance;
      } else if (acc.type === "liability") {
        balance = acc.credit - acc.debit; // normal credit balance
        if (balance !== 0) liabilities[acc.name] = Number(balance.toFixed(2));
        liabilityTotal += balance;
      } else if (acc.type === "equity") {
        balance = acc.credit - acc.debit; // normal credit balance
        if (balance !== 0) equity[acc.name] = Number(balance.toFixed(2));
        equityTotal += balance;
      }
    });

    assetTotal = Number(assetTotal.toFixed(2));
    liabilityTotal = Number(liabilityTotal.toFixed(2));
    equityTotal = Number(equityTotal.toFixed(2));

    const balanceCheck = Number(
      (assetTotal - (liabilityTotal + equityTotal)).toFixed(2)
    );

    return res.json({
      success: true,
      assets,
      liabilities,
      equity,
      totals: {
        assetTotal,
        liabilityTotal,
        equityTotal,
      },
      balanceCheck, // should be ≈ 0 if closing entries are done
    });
  } catch (err) {
    console.error("getBalanceSheet error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   5. VAT REPORT (already matching your table)
------------------------------------------ */
export const getVATReport = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { data, error } = await supabase
      .from("vat_reports")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("period", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    console.error("getVATReport error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------
   6. PROFIT & LOSS (Income / Expense)
------------------------------------------ */
export const getProfitAndLoss = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // 1️⃣ Income & Expense accounts from COA
    const { data: accounts, error: accErr } = await supabase
      .from("coa")
      .select("id, name, type")
      .eq("tenant_id", tenant_id)
      .in("type", ["income", "expense"]);

    if (accErr) throw accErr;

    if (!accounts || accounts.length === 0) {
      return res.json({
        success: true,
        income_total: 0,
        expense_total: 0,
        net_profit: 0,
        income_accounts: [],
        expense_accounts: [],
      });
    }

    const accountIds = accounts.map((a) => a.id);

    // 2️⃣ Fetch journal entries that hit these accounts
    let entries = [];
    if (accountIds.length > 0) {
      const idList = accountIds.join(",");
      const { data, error: entErr } = await supabase
        .from("journal_entries")
        .select("debit_account, credit_account, amount")
        .eq("tenant_id", tenant_id)
        .or(`debit_account.in.(${idList}),credit_account.in.(${idList})`);

      if (entErr) throw entErr;
      entries = data || [];
    }

    // 3️⃣ Prepare P&L map
    const pnl = {};
    accounts.forEach((a) => {
      pnl[a.id] = {
        account_id: a.id,
        name: a.name,
        type: a.type, // "income" or "expense"
        debit: 0,
        credit: 0,
      };
    });

    // 4️⃣ Sum debits & credits
    entries.forEach((e) => {
      const amt = Number(e.amount || 0);

      if (pnl[e.debit_account]) {
        pnl[e.debit_account].debit += amt;
      }
      if (pnl[e.credit_account]) {
        pnl[e.credit_account].credit += amt;
      }
    });

    // 5️⃣ Build income & expense lists + totals
    const income_accounts = [];
    const expense_accounts = [];

    let incomeTotal = 0;
    let expenseTotal = 0;

    Object.values(pnl).forEach((acc) => {
      if (acc.type === "income") {
        const amount = Number((acc.credit - acc.debit).toFixed(2)); // credit nature
        income_accounts.push({
          account_id: acc.account_id,
          name: acc.name,
          amount,
        });
        incomeTotal += amount;
      } else if (acc.type === "expense") {
        const amount = Number((acc.debit - acc.credit).toFixed(2)); // debit nature
        expense_accounts.push({
          account_id: acc.account_id,
          name: acc.name,
          amount,
        });
        expenseTotal += amount;
      }
    });

    incomeTotal = Number(incomeTotal.toFixed(2));
    expenseTotal = Number(expenseTotal.toFixed(2));
    const netProfit = Number((incomeTotal - expenseTotal).toFixed(2));

    return res.json({
      success: true,
      income_total: incomeTotal,
      expense_total: expenseTotal,
      net_profit: netProfit,
      income_accounts,
      expense_accounts,
    });
  } catch (err) {
    console.error("getProfitAndLoss error:", err);
    return res.status(500).json({ error: err.message });
  }
};
