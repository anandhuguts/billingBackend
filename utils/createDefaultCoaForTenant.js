import { supabase } from "../supabase/supabaseClient.js";

export async function createDefaultCoaForTenant(tenant_id) {
  // Check if COA already exists
  const { data: exists, error: checkErr } = await supabase
    .from("coa")
    .select("id")
    .eq("tenant_id", tenant_id)
    .limit(1);

  if (checkErr) throw checkErr;
  if (exists && exists.length > 0) {
    console.log("COA already exists for tenant:", tenant_id);
    return;
  }

  const defaultAccounts = [
    // ASSETS
    { name: "Cash", type: "asset" },
    { name: "Bank", type: "asset" },
    { name: "Inventory", type: "asset" },
    { name: "Accounts Receivable", type: "asset" },
    { name: "VAT Input", type: "asset" },
    { name: "Employee Advance", type: "asset" },

    // LIABILITIES
    { name: "Accounts Payable", type: "liability" },
    { name: "VAT Payable", type: "liability" },

    // 🔥 REQUIRED FOR SALES RETURNS
    { name: "VAT Output", type: "liability" },

    // INCOME
    { name: "Sales", type: "income" },

    // EXPENSES
    { name: "Cost of Goods Sold", type: "expense" },
    { name: "COGS", type: "expense" }, // alias to prevent lookup mismatch
    { name: "Discount Expense", type: "expense" },
    { name: "Salary Expense", type: "expense" },
    { name: "Staff Discount Expense", type: "expense" },
  ];

  const rows = defaultAccounts.map((acc) => ({
    tenant_id,
    name: acc.name,
    type: acc.type,
    parent_id: null,
  }));

  const { error: insertErr } = await supabase.from("coa").insert(rows);
  if (insertErr) throw insertErr;

  console.log("Default COA created for tenant:", tenant_id);
}
