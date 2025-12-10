// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { addJournalEntry } from "../services/addJournalEntryService.js";
import { insertLedgerEntry } from "../services/insertLedgerEntryService.js";
import { calculateEmployeeDiscount } from "../services/calculateEmployeeDiscountServices.js";
import { applyDiscounts } from "../services/applyDiscountsService.js";
import { generatePDF } from "../scripts/pdfGenerator.js";


export const createInvoice = async (req, res) => {

  const baseUrl = `${req.protocol}://${req.get("host")}`;
const businessName = req.user.full_name|| "SUPERMART";
  try {
    const tenant_id = req.user.tenant_id;
    const {
      items = [],
      payment_method = "cash",
      customer_id = null,
      redeem_points = 0,
      coupon_code = null,
    } = req.body;
    console.log(req.body);

    

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    // ======================================
// FETCH PRODUCT PRICES & TAX FROM DB
// ======================================
const productIds = items.map((i) => i.product_id);

const { data: productData, error: prodErr } = await supabase
  .from("products")
  .select("id, selling_price, tax")
  .in("id", productIds);

if (prodErr) {
  return res.status(500).json({ error: "Failed to fetch product info" });
}

const mergedItems = items.map((i) => {
  const p = productData.find((x) => x.id === i.product_id);
  if (!p) throw new Error(`Product not found: ${i.product_id}`);

  return {
    product_id: i.product_id,
    qty: i.qty,
    price: Number(p.selling_price),   // backend price override
    tax: Number(p.tax),       // backend tax override
  };
});


    const isLoyaltyCustomer = !!customer_id;
    let customer = null;
    if (isLoyaltyCustomer) {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, loyalty_points, lifetime_points, total_purchases, total_spent, membership_tier"
        )
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();
      if (error || !data)
        return res.status(404).json({ error: "Customer not found" });
      customer = data;
    }

    // 1) Apply discounts
    let discountResult;
    try {
    discountResult = await applyDiscounts({
  items: mergedItems,
  tenant_id,
  customer,
  couponCode: coupon_code,
});

    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const {
      items: itemsWithDiscounts,
      subtotal,
      item_discount_total,
      bill_discount_total,
      coupon_discount_total,
      membership_discount_total,
      total_before_redeem,
      invoiceDiscounts,
      appliedCouponRule,
    } = discountResult;
// ====================================
// EMPLOYEE DISCOUNT (STAFF USER ONLY)
// ====================================
const { discount: employee_discount_total } = await calculateEmployeeDiscount({
  tenant_id,
  buyer_employee_id: req.body.employee_id || null,
  subtotal
});



    let total_amount =
  total_before_redeem - employee_discount_total;


    // 2) Coupon per-customer limit validation (if coupon and customer)
    if (
      appliedCouponRule &&
      isLoyaltyCustomer &&
      appliedCouponRule.per_customer_limit
    ) {
      const { data: usesByCustomer } = await supabase
        .from("coupon_usage")
        .select("id")
        .eq("coupon_id", appliedCouponRule.id)
        .eq("customer_id", customer_id);
      if (
        usesByCustomer &&
        usesByCustomer.length >= appliedCouponRule.per_customer_limit
      ) {
        return res
          .status(400)
          .json({ error: "Coupon usage limit reached for this customer" });
      }
    }

    // 3) Redeem points (if requested)
    let currentPoints = customer ? Number(customer.loyalty_points || 0) : 0;
    let lifetimePoints = customer ? Number(customer.lifetime_points || 0) : 0;

    if (isLoyaltyCustomer && redeem_points > 0) {
      if (redeem_points > currentPoints)
        return res.status(400).json({ error: "Not enough loyalty points" });

      total_amount = Number((total_amount - redeem_points).toFixed(2));
      currentPoints -= redeem_points;

      await supabase.from("loyalty_transactions").insert([
        {
          customer_id,
          invoice_id: null,
          transaction_type: "redeem",
          points: -redeem_points,
          balance_after: currentPoints,
          description: `Redeemed ${redeem_points} points`,
        },
      ]);
    }

    if (total_amount < 0) total_amount = 0;

    // 4) Create invoice with discount summary fields
    // 3.1) Generate per-tenant sales invoice sequence
    const { data: counter } = await supabase
      .from("tenant_counters")
      .select("sales_seq")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    let seq = 1;

    if (!counter) {
      // first invoice for this tenant
      await supabase
        .from("tenant_counters")
        .insert([{ tenant_id, sales_seq: 1 }]);
    } else {
      seq = counter.sales_seq + 1;
      await supabase
        .from("tenant_counters")
        .update({ sales_seq: seq })
        .eq("tenant_id", tenant_id);
    }

    // Generate invoice number format: INV-2025-0001
    const year = new Date().getFullYear();
    const invoice_number = `INV-${year}-${String(seq).padStart(4, "0")}`;

    // 4) Insert invoice WITHOUT invoice_number first
// ===========================
// 4) INSERT INVOICE (DEBUG LOGGING)
// ===========================


const insertPayload = {
  tenant_id,
  handled_by: req.user.id,
  customer_id: isLoyaltyCustomer ? customer_id : null,
  total_amount,
  payment_method,
  item_discount_total,
  bill_discount_total,
  coupon_discount_total,
  membership_discount_total,
  employee_discount_total,
  final_amount: total_amount,
};



const insertResult = await supabase
  .from("invoices")
  .insert([insertPayload])
  .select("*")
  .maybeSingle();



const invoice = insertResult.data;
const invoiceErr = insertResult.error;

if (invoiceErr) {
  console.error("❌ SUPABASE INSERT ERROR:", invoiceErr);
  return res.status(500).json({ error: invoiceErr.message });
}

if (!invoice) {
  console.error("❌ INSERT RETURNED NULL. MOST LIKELY CAUSE: Missing required column.");
  return res.status(500).json({ error: "Invoice insert returned null. Check console." });
}




      // === UPDATE EMPLOYEE DISCOUNT USAGE WITH INVOICE ID ===
if (employee_discount_total > 0) {
  await supabase
    .from("employee_discount_usage")
    .update({ invoice_id: invoice.id })
    .eq("employee_id", req.body.employee_id)
    .is("invoice_id", null);
}


    if (invoiceErr) throw invoiceErr;

    // 4.1) Now attach the invoice_number
    await supabase
      .from("invoices")
      .update({ invoice_number })
      .eq("id", invoice.id);


      const { data: updatedInvoice } = await supabase
  .from("invoices")
  .select("*")
  .eq("id", invoice.id)
  .single();

    // 5) Attach invoice_id to earlier redeem transactions
    if (isLoyaltyCustomer && redeem_points > 0) {
      await supabase
        .from("loyalty_transactions")
        .update({ invoice_id: invoice.id })
        .eq("customer_id", customer_id)
        .is("invoice_id", null);
    }

    // 6) Insert invoice_items with per-unit discount & net_price
    const invoiceItemsToInsert = itemsWithDiscounts.map((it) => {
  const qty = Number(it.qty || 0);
  const price = Number(it.price || 0);
  const discountPerUnit = Number(it.discount_amount || 0);
  const netUnit = price - discountPerUnit;
  const lineTotal = netUnit * qty;

  return {
    tenant_id,
    invoice_id: invoice.id,
    product_id: it.product_id,
    quantity: qty,
    price,
    tax: it.tax,   // percent
    tax_amount: Number(it.taxAmount || 0),  // <-- NEW FIELD
    discount_amount: discountPerUnit,
    net_price: netUnit,
    total: lineTotal,
  };
});


    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItemsToInsert);
    if (itemsError) throw itemsError;

    // 7) Insert invoice-level discount rows (invoice_discounts)
    for (const invDisc of invoiceDiscounts) {
      await supabase.from("invoice_discounts").insert([
        {
          invoice_id: invoice.id,
          rule_id: invDisc.rule_id,
          amount: invDisc.amount,
          description: invDisc.description,
        },
      ]);
    }

    // 8) Record coupon usage (if coupon applied)
    if (appliedCouponRule) {
      await supabase.from("coupon_usage").insert([
        {
          customer_id: isLoyaltyCustomer ? customer_id : null,
          coupon_id: appliedCouponRule.id,
          invoice_id: invoice.id,
        },
      ]);
    }

    // 9) Update inventory
  // 9) Update inventory
const lowStockAlerts = [];
for (const it of itemsWithDiscounts) {
  const { data: invData } = await supabase
    .from("inventory")
    .select("id, quantity, reorder_level, product_id")
    .eq("tenant_id", tenant_id)
    .eq("product_id", it.product_id)
    .maybeSingle();

  // ❌ A sale should NEVER create inventory
  if (!invData) {
    throw new Error(
      `Inventory not found for product_id ${it.product_id}. 
       Add inventory via PURCHASE first.`
    );
  }

  const newQty = Math.max(0, Number(invData.quantity || 0) - it.qty);

  await supabase
    .from("inventory")
    .update({ quantity: newQty })
    .eq("id", invData.id)
    .eq("tenant_id", tenant_id);

  if (newQty <= Number(invData.reorder_level || 0)) {
    lowStockAlerts.push({
      product_id: it.product_id,
      newQty,
      reorder_level: invData.reorder_level,
    });
  }
}

    // 9.1) INSERT STOCK MOVEMENTS FOR SALES
    for (const it of itemsWithDiscounts) {
      await supabase.from("stock_movements").insert([
        {
          tenant_id,
          product_id: it.product_id,
          movement_type: "sale",
          reference_table: "invoices",
          reference_id: invoice.id,
          quantity: -Number(it.qty),
          created_at: new Date().toISOString(),
        },
      ]);
    }

    // 10) Earn loyalty points (after final total_amount)
    let earn_points = 0;
    if (isLoyaltyCustomer) {
      const { data: earnRule } = await supabase
        .from("loyalty_rules")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (earnRule && earnRule.points_per_currency && earnRule.currency_unit) {
        const currency_unit = Number(earnRule.currency_unit || 100);
        const points_per_currency = Number(earnRule.points_per_currency || 1);
        earn_points = Math.floor(
          (total_amount / currency_unit) * points_per_currency
        );
      } else {
        earn_points = Math.floor(total_amount / 100); // fallback
      }

      currentPoints += earn_points;
      lifetimePoints += earn_points;

      await supabase
        .from("customers")
        .update({
          loyalty_points: currentPoints,
          lifetime_points: lifetimePoints,
          last_purchase_at: new Date(),
          total_purchases: (customer.total_purchases || 0) + 1,
          total_spent: Number(customer.total_spent || 0) + total_amount,
        })
        .eq("id", customer_id);

      await supabase.from("loyalty_transactions").insert([
        {
          customer_id,
          invoice_id: invoice.id,
          transaction_type: "earn",
          points: earn_points,
          balance_after: currentPoints,
          description: `Earned ${earn_points} points for invoice #${invoice.id}`,
        },
      ]);
    }

    // 11) Update invoice final_amount and totals in DB
    await supabase
      .from("invoices")
      .update({
        item_discount_total,
        bill_discount_total,
        coupon_discount_total,
        membership_discount_total,
        employee_discount_total,

        final_amount: total_amount,
      })
      .eq("id", invoice.id);

    // 12) ACCOUNTING: Daybook, Ledger, VAT, COGS

    // === FETCH COA ACCOUNTS FOR THIS TENANT ===
    const { data: coaAccounts, error: coaErr } = await supabase
      .from("coa")
      .select("id, name")
      .eq("tenant_id", tenant_id);

    if (coaErr || !coaAccounts || coaAccounts.length === 0) {
      throw new Error("COA accounts not found for this tenant");
    }

    function coaId(name) {
      const acc = coaAccounts.find(
        (a) => a.name.toLowerCase() === name.toLowerCase()
      );
      if (!acc) throw new Error(`COA account not found: ${name}`);
      return acc.id;
    }

    try {
      const saleAmount = total_amount;
      const saleDescription = `Invoice #${
        invoice.invoice_number || invoice.id
      }`;

      // Daybook entry (Sale)
      await supabase.from("daybook").insert([
        {
          tenant_id,
          entry_type: "sale",
          description: saleDescription,
          debit: 0,
          credit: saleAmount,
          reference_id: invoice.id,
        },
      ]);

      // Tax total from items (after item-level discounts)
      const totalTax = itemsWithDiscounts.reduce(
        (s, it) => s + Number(it.taxAmount || 0),
        0
      );
      const netSales = Math.max(0, saleAmount - totalTax);

      // Ledger: Debit CASH / RECEIVABLE
      const paymentAccountType =
        payment_method === "credit" ? "Accounts Receivable" : "cash";

      await insertLedgerEntry({
        tenant_id,
        account_type: paymentAccountType,
        account_id: payment_method === "credit" ? customer_id : null,
        entry_type: "debit",
        description: saleDescription,
        debit: saleAmount,
        credit: 0,
        reference_id: invoice.id,
      });

      // Ledger: Credit SALES
      if (netSales > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "sales",
          account_id: null,
          entry_type: "credit",
          description: saleDescription,
          debit: 0,
          credit: netSales,
          reference_id: invoice.id,
        });
      }

      // Ledger: Credit VAT PAYABLE
      if (totalTax > 0) {
        await insertLedgerEntry({
          tenant_id,
          account_type: "VAT Payable",
          account_id: null,
          entry_type: "credit",
          description: `VAT for ${saleDescription}`,
          debit: 0,
          credit: totalTax,
          reference_id: invoice.id,
        });
      }

      // JOURNAL ENTRIES

      // CASE 1: CASH SALE
      if (payment_method !== "credit") {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Cash"),
          credit_account: coaId("Sales"),
          amount: netSales,
          description: saleDescription,
          reference_id: invoice.id,
        });

        if (totalTax > 0) {
          await addJournalEntry({
            tenant_id,
            debit_account: coaId("Cash"),
            credit_account: coaId("VAT Payable"),
            amount: totalTax,
            description: `VAT for ${saleDescription}`,
            reference_id: invoice.id,
          });
        }
      }

      // CASE 2: CREDIT SALE
      if (payment_method === "credit") {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Accounts Receivable"),
          credit_account: coaId("Sales"),
          amount: netSales,
          description: saleDescription,
          reference_id: invoice.id,
        });

        if (totalTax > 0) {
          await addJournalEntry({
            tenant_id,
            debit_account: coaId("Accounts Receivable"),
            credit_account: coaId("VAT Payable"),
            amount: totalTax,
            description: `VAT for ${saleDescription}`,
            reference_id: invoice.id,
          });
        }
      }

      // DISCOUNTS (Expense)
      if (item_discount_total > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Discount Expense"),
          credit_account: coaId("Sales"),
          amount: item_discount_total,
          description: `Item discount for invoice #${invoice.id}`,
          reference_id: invoice.id,
        });
      }

      // EMPLOYEE DISCOUNT (Expense)
if (employee_discount_total > 0) {
  await addJournalEntry({
    tenant_id,
    debit_account: coaId("Staff Discount Expense"),
    credit_account: coaId("Sales"),
    amount: employee_discount_total,
    description: `Employee discount for invoice #${invoice.id}`,
    reference_id: invoice.id,
  });
}


      if (bill_discount_total > 0) {
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Discount Expense"),
          credit_account: coaId("Sales"),
          amount: bill_discount_total,
          description: `Bill discount for invoice #${invoice.id}`,
          reference_id: invoice.id,
        });
      }

      // 12.1) COGS + Inventory accounting (using cost_price)
      for (const it of itemsWithDiscounts) {
        const { data: prod } = await supabase
          .from("products")
          .select("cost_price")
          .eq("id", it.product_id)
          .maybeSingle();

        if (!prod || prod.cost_price == null) continue;

        const unitCost = Number(prod.cost_price);
        const lineCost = unitCost * Number(it.qty || 0);

        if (lineCost <= 0) continue;

        // Journal: DR COGS, CR Inventory
        await addJournalEntry({
          tenant_id,
          debit_account: coaId("Cost of Goods Sold"),
          credit_account: coaId("Inventory"),
          amount: lineCost,
          description: `COGS for invoice #${invoice.id}`,
          reference_id: invoice.id,
        });

        // Ledger: DR COGS
        await insertLedgerEntry({
          tenant_id,
          account_type: "cogs",
          entry_type: "debit",
          description: `COGS for invoice #${invoice.id}`,
          debit: lineCost,
          credit: 0,
          reference_id: invoice.id,
        });

        // Ledger: CR Inventory
        await insertLedgerEntry({
          tenant_id,
          account_type: "inventory",
          entry_type: "credit",
          description: `Inventory reduction for invoice #${invoice.id}`,
          debit: 0,
          credit: lineCost,
          reference_id: invoice.id,
        });
      }

      // VAT REPORT (monthly, period = YYYY-MM)
      const now = invoice.created_at
        ? new Date(invoice.created_at)
        : new Date();
      const period = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;

      const { data: existingVat, error: vatErr } = await supabase
        .from("vat_reports")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("period", period)
        .maybeSingle();

      if (vatErr) {
        console.error("VAT fetch error:", vatErr);
      } else if (existingVat) {
        const newTotalSales =
          Number(existingVat.total_sales || 0) + Number(saleAmount || 0);
        const newSalesVat =
          Number(existingVat.sales_vat || 0) + Number(totalTax || 0);
        const newPurchaseVat = Number(existingVat.purchase_vat || 0);
        const newVatPayable = newSalesVat - newPurchaseVat;

        const { error: updateVatErr } = await supabase
          .from("vat_reports")
          .update({
            total_sales: newTotalSales,
            sales_vat: newSalesVat,
            vat_payable: newVatPayable,
          })
          .eq("id", existingVat.id);

        if (updateVatErr) {
          console.error("VAT update error:", updateVatErr);
        }
      } else {
        const { error: insertVatErr } = await supabase
          .from("vat_reports")
          .insert([
            {
              tenant_id,
              period,
              total_sales: saleAmount,
              sales_vat: totalTax,
              total_purchases: 0,
              purchase_vat: 0,
              vat_payable: totalTax,
            },
          ]);
        if (insertVatErr) {
          console.error("VAT insert error:", insertVatErr);
        }
      }
    } catch (accErr) {
      console.error("Accounting entries failed:", accErr);
      // we don't fail the invoice if accounting tables fail
    }

    // 13) Fetch product names and merge into items (for response)
 const productIds2 = [
  ...new Set(invoiceItemsToInsert.map((i) => i.product_id)),
];

const { data: productNames, error: productNameErr } = await supabase
  .from("products")
  .select("id, name")
  .in("id", productIds2);

if (productNameErr) throw productNameErr;

const productMap = {};
(productNames || []).forEach((p) => {
  productMap[p.id] = p.name;
});


    const itemsWithNames = invoiceItemsToInsert.map((it) => ({
      ...it,
      name: productMap[it.product_id] || "Unknown",
    }));

    // -------------------------------------------
// 14) GENERATE RECEIPT PDF (BACKEND VERSION)
// -------------------------------------------
const pdfUrl = await generatePDF({
  invoiceNumber: invoice_number,
  items: itemsWithNames,
  total: total_amount,
  payment_method,
  subtotal,
  baseUrl,
  businessName
});
res.setHeader("Content-Type", "application/pdf");
res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoice_number}.pdf`);
return res.send(pdfUrl);

    // Final response
  return res.status(201).json({
  message: "Invoice created successfully",
  invoice: {
    ...invoice,
    ...updatedInvoice,
    subtotal,
    final_amount: total_amount,
    pdf_url: pdfUrl
  },
  items: itemsWithNames,
  lowStockAlerts,
  loyalty: isLoyaltyCustomer
    ? {
        earned: earn_points,
        redeemed: redeem_points,
        final_balance: currentPoints,
      }
    : null,
});

  } catch (err) {
    console.error("createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

/**
 * generatePDF (unchanged)
 */
// export const generatePDF = async (req, res) => {
//   try {
//     const { invoiceNumber, items, subtotal, total, payment_method } = req.body;

//     const invoicesDir = path.join(process.cwd(), "invoices");
//     if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

//     const filePath = path.join(invoicesDir, `invoice-${invoiceNumber}.pdf`);

//     // 80mm thermal = approx 226 pts width, height variable
//     const doc = new PDFDocument({
//       size: [226, 600],
//       margin: 10,
//     });

//     const stream = fs.createWriteStream(filePath);
//     doc.pipe(stream);

//     let y = 10;

//     const center = (text, size = 10, font = "Courier") => {
//       doc.font(font).fontSize(size);
//       doc.text(text, 0, y, { width: 226, align: "center" });
//       y += size + 2;
//     };

//     const line = () => {
//       doc
//         .font("Courier")
//         .fontSize(9)
//         .text("----------------------------------------", 0, y, {
//           width: 226,
//           align: "center",
//         });
//       y += 12;
//     };

//     const starLine = () => {
//       doc
//         .font("Courier")
//         .fontSize(10)
//         .text("********************************", 0, y, {
//           width: 226,
//           align: "center",
//         });
//       y += 14;
//     };

//     // ⭐ Top Stars
//     starLine();

//     // ⭐ Store Name
//     center("SUPERMART", 16);

//     // ⭐ Bottom Stars
//     starLine();

//     // Invoice details
//     doc.font("Courier").fontSize(9).text(`Invoice No: ${invoiceNumber}`, 10, y);
//     y += 12;

//     doc
//       .font("Courier")
//       .fontSize(9)
//       .text(`Date: ${new Date().toLocaleString()}`, 10, y);
//     y += 14;

//     // Divider
//     line();

//     // Items
//     doc.font("Courier").fontSize(10);

//     items.forEach((item) => {
//       const name = `${item.qty}x ${item.name}`;
//       const price = `AED ${Number(item.total).toFixed(2)}`;

//       doc.text(name, 10, y);
//       doc.text(price, -10, y, { align: "right" });
//       y += 14;
//     });

//     // Divider
//     y += 2;
//     line();

//     // TOTAL bold
//     doc.font("Courier-Bold").fontSize(11);
//     doc.text("TOTAL:", 10, y);
//     doc.text(`AED ${total.toFixed(2)}`, -10, y, { align: "right" });
//     y += 16;

//     // Payment Method
//     doc.font("Courier").fontSize(10);
//     doc.text("Payment Method:", 10, y);
//     doc.text(payment_method.toUpperCase(), -10, y, { align: "right" });
//     y += 14;

//     // Divider
//     line();

//     // Thank you
//     doc.font("Courier-Bold").fontSize(10);
//     center("********* THANK YOU! *********", 10);

//     y += 10;

//     // Simple barcode mimic
//     const barStartX = 40;
//     const barWidth = 100;

//     for (let i = 0; i < 40; i++) {
//       const x = barStartX + i * 2.2;
//       const lineW = Math.random() > 0.5 ? 1.2 : 0.6;

//       doc
//         .moveTo(x, y)
//         .lineTo(x, y + 25)
//         .lineWidth(lineW)
//         .stroke();
//     }

//     doc.end();

//     stream.on("finish", () => {
//       res.status(200).json({
//         message: "Invoice PDF generated",
//         pdf_url: `http://localhost:5000/invoices/invoice-${invoiceNumber}.pdf`,
//       });
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to generate invoice PDF" });
//   }
// };
