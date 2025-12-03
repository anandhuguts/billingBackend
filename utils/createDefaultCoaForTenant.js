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
    // Assets
    { name: "Cash", type: "asset" },
    { name: "Bank", type: "asset" },
    { name: "Inventory", type: "asset" },
    { name: "Accounts Receivable", type: "asset" },
    { name: "VAT Input", type: "asset" },
    { name: "Employee Advance", type: "asset" },   // NEW

    // Liabilities
    { name: "Accounts Payable", type: "liability" },
    { name: "VAT Payable", type: "liability" },

    // Income
    { name: "Sales", type: "income" },

    // Expenses
    { name: "Cost of Goods Sold", type: "expense" },
    { name: "Discount Expense", type: "expense" },
    { name: "Salary Expense", type: "expense" },           // NEW
    { name: "Staff Discount Expense", type: "expense" },   // NEW
  ];

  const rows = defaultAccounts.map((acc) => ({
    tenant_id,
    name: acc.name,
    type: acc.type,
    parent_id: null, // your schema supports null parent
  }));

  const { error: insertErr } = await supabase.from("coa").insert(rows);
  if (insertErr) throw insertErr;

  console.log("Default COA created for tenant:", tenant_id);
}
