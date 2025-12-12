// ===========================
// PURCHASE ACCOUNTING (NEW SYSTEM)
// Matches Invoice logic 100%
// ===========================

export async function processPurchaseAccounting({
  tenant_id,
  purchase_id,
  invoice_number,
  netTotal,
  taxTotal,
  total_amount,
  payment_method,
  coaAccounts,
  created_at
}) {
  const desc = `Purchase #${invoice_number}`;

  // -------------------------------------
  // 1) Map COA Accounts
  // -------------------------------------
  const get = (name) => {
    const acc = coaAccounts.find(
      (a) => a.name.toLowerCase() === name.toLowerCase()
    );
    if (!acc) throw new Error(`COA missing: ${name}`);
    return acc;
  };

  const inventoryAcc = get("Inventory");
  const vatInputAcc = get("VAT Input");
  const cashAcc = get("Cash");
  const apAcc = get("Accounts Payable");

  const isCredit = payment_method === "credit";

  // -------------------------------------
  // 2) Daybook Entry
  // -------------------------------------
  await supabase.from("daybook").insert([
    {
      tenant_id,
      entry_type: "purchase",
      description: desc,
      debit: total_amount,
      credit: 0,
      reference_id: purchase_id,
    },
  ]);

  // -------------------------------------
  // 3) JOURNAL ENTRIES (double-entry)
  // -------------------------------------

  // Inventory increase
  await addJournalEntry({
    tenant_id,
    debit_account: inventoryAcc.id,
    credit_account: isCredit ? apAcc.id : cashAcc.id,
    amount: netTotal,
    description: `${desc} - Inventory`,
    reference_id: purchase_id,
    reference_type: "purchase",
  });

  // VAT input
  if (taxTotal > 0) {
    await addJournalEntry({
      tenant_id,
      debit_account: vatInputAcc.id,
      credit_account: isCredit ? apAcc.id : cashAcc.id,
      amount: taxTotal,
      description: `${desc} - VAT Input`,
      reference_id: purchase_id,
      reference_type: "purchase",
    });
  }

  // -------------------------------------
  // 4) VAT REPORT UPDATE
  // -------------------------------------
  const date = new Date(created_at);
  const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  const { data: vatRow } = await supabase
    .from("vat_reports")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("period", period)
    .maybeSingle();

  if (vatRow) {
    await supabase
      .from("vat_reports")
      .update({
        total_purchases: Number(vatRow.total_purchases) + netTotal,
        purchase_vat: Number(vatRow.purchase_vat) + taxTotal,
        vat_payable:
          Number(vatRow.sales_vat || 0) -
          (Number(vatRow.purchase_vat || 0) + taxTotal),
      })
      .eq("id", vatRow.id);
  } else {
    await supabase.from("vat_reports").insert([
      {
        tenant_id,
        period,
        total_sales: 0,
        sales_vat: 0,
        total_purchases: netTotal,
        purchase_vat: taxTotal,
        vat_payable: -taxTotal,
      },
    ]);
  }
}
