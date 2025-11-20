import { supabase } from "../supabase/supabaseClient.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * @route POST /api/invoices
 * @desc Create a new invoice and update inventory
 */
export const createInvoice = async (req, res) => {
  console.log("Incoming invoice:", req.body);

  try {
    const tenant_id = req.user.tenant_id;
    const { items = [], payment_method = "cash", customer_id = null, redeem_points = 0 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    const isLoyaltyCustomer = !!customer_id;

    // 🧮 Step 1 — Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const tax_total = items.reduce(
      (sum, item) => sum + (item.price * item.tax / 100) * item.qty,
      0
    );

    let total_amount = subtotal + tax_total;

    // ---------------------------------------------------------------------
    // ⭐ STEP 2 — HANDLE LOYALTY (ONLY IF CUSTOMER SELECTED)
    // ---------------------------------------------------------------------
    let currentPoints = 0;
    let lifetimePoints = 0;
    let customer = null;

    if (isLoyaltyCustomer) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, loyalty_points, lifetime_points, total_purchases, total_spent")
        .eq("id", customer_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (error || !data) return res.status(404).json({ error: "Customer not found" });

      customer = data;
      currentPoints = data.loyalty_points;
      lifetimePoints = data.lifetime_points;

      // ⭐ Redeem points
      if (redeem_points > 0) {
        if (redeem_points > currentPoints) {
          return res.status(400).json({ error: "Not enough loyalty points" });
        }

        // reduce bill
        total_amount -= redeem_points;
        currentPoints -= redeem_points;

        // record redemption (invoice_id will be attached later)
        await supabase.from("loyalty_transactions").insert([
          {
            customer_id,
            invoice_id: null,
            transaction_type: "redeem",
            points: -redeem_points,
            balance_after: currentPoints,
            description: `Redeemed ${redeem_points} points`
          }
        ]);
      }
    }

    // ---------------------------------------------------------------------
    // 🧾 Step 3 — Create invoice
    // ---------------------------------------------------------------------
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert([
        {
          tenant_id,
          customer_id: isLoyaltyCustomer ? customer_id : null,
          total_amount,
          payment_method,
        },
      ])
      .select()
      .single();

    if (invoiceError) throw invoiceError;
    console.log("Created invoice:", invoice);

    // update redeem transaction invoice_id now that invoice exists
    if (isLoyaltyCustomer && redeem_points > 0) {
      await supabase
        .from("loyalty_transactions")
        .update({ invoice_id: invoice.id })
        .eq("customer_id", customer_id)
        .is("invoice_id", null);
    }

    // ---------------------------------------------------------------------
    // 🧩 Step 4 — Insert invoice items
    // ---------------------------------------------------------------------
    const invoiceItems = items.map((item) => ({
      tenant_id,
      invoice_id: invoice.id,
      product_id: item.product_id,
      quantity: item.qty,
      price: item.price,
      tax: item.tax,
      total: item.total,
    }));

    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItems);

    if (itemsError) throw itemsError;

    // ---------------------------------------------------------------------
    // 📦 Step 5 — Update inventory (your existing logic)
    // ---------------------------------------------------------------------
    const lowStockAlerts = [];

    for (const item of items) {
      const { data: invData } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, max_stock, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", item.product_id)
        .single();

      if (!invData) {
        await supabase.from("inventory").insert([
          {
            tenant_id,
            product_id: item.product_id,
            quantity: 0,
            reorder_level: 5,
            max_stock: 100,
          },
        ]);
        continue;
      }

      const newQty = Math.max(0, invData.quantity - item.qty);

      await supabase
        .from("inventory")
        .update({ quantity: newQty })
        .eq("id", invData.id)
        .eq("tenant_id", tenant_id);

      if (newQty <= invData.reorder_level) {
        lowStockAlerts.push({
          product_id: item.product_id,
          newQty,
          reorder_level: invData.reorder_level,
        });
      }
    }

    // ---------------------------------------------------------------------
    // ⭐ STEP 6 — EARN LOYALTY POINTS (ONLY IF CUSTOMER SELECTED)
    // ---------------------------------------------------------------------
    let earn_points = 0;

    if (isLoyaltyCustomer) {

      const { data: rule, error: ruleErr } = await supabase
  .from("loyalty_rules")
  .select("*")
  .eq("tenant_id", tenant_id)
  .eq("is_active", true)
  .single();

      earn_points = Math.floor(
  (total_amount / rule.currency_unit) * rule.points_per_currency
); // 1 per ₹100 spent

      currentPoints += earn_points;
      lifetimePoints += earn_points;

      // Update customer loyalty summary
      await supabase
        .from("customers")
        .update({
          loyalty_points: currentPoints,
          lifetime_points: lifetimePoints,
          last_purchase_at: new Date(),
          total_purchases: (customer.total_purchases || 0) + 1,
          total_spent: (customer.total_spent || 0) + total_amount,
        })
        .eq("id", customer_id);

      // Insert loyalty transaction
      await supabase.from("loyalty_transactions").insert([
        {
          customer_id,
          invoice_id: invoice.id,
          transaction_type: "earn",
          points: earn_points,
          balance_after: currentPoints,
          description: `Earned ${earn_points} points for invoice #${invoice.id}`,
        }
      ]);
    }

    // ---------------------------------------------------------------------
    // ⭐ FINAL RESPONSE
    // ---------------------------------------------------------------------
    return res.status(201).json({
      message: "Invoice created successfully",
      invoice,
      items: invoiceItems,
      lowStockAlerts,
      loyalty: isLoyaltyCustomer
        ? {
            earned: earn_points,
            redeemed: redeem_points,
            final_balance: currentPoints,
          }
        : null, // no loyalty for walk-in customers
    });

  } catch (err) {
    console.error("❌ createInvoice error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};


export const generatePDF = async (req, res) => {
  try {
    const { invoiceNumber, items, subtotal, total, payment_method } = req.body;

    // 1️⃣ Ensure the invoices folder exists
    const invoicesDir = path.join(process.cwd(), "invoices");
    if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

    // 2️⃣ Create the new PDF
    const filePath = path.join(invoicesDir, `invoice-${invoiceNumber}.pdf`);
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // 3️⃣ Write invoice content
    doc.fontSize(18).text("SUPERMART", { align: "center" }).moveDown(0.5);
    doc.fontSize(10).text(`Invoice No: ${invoiceNumber}`);
    doc.text(`Date: ${new Date().toLocaleString()}`);
    doc.moveDown(1);
    doc.text("========================================", { align: "center" });

    // 4️⃣ Add items
    items.forEach((item) => {
      doc.text(`${item.qty}x ${item.name} - AED ${item.total.toFixed(2)}`);
    });

    doc.moveDown(1);
    doc.text("========================================", { align: "center" });

    // 5️⃣ Totals
    doc.text(`Subtotal: AED ${subtotal.toFixed(2)}`);
    doc.text(`Payment Method: ${payment_method}`);
    doc.fontSize(14).text(`Total: AED ${total.toFixed(2)}`, { align: "right" });

    doc.moveDown(1.5);
    doc.fontSize(10).text("Thank you for shopping with us!", { align: "center" });

    doc.end();

    // 6️⃣ Respond when done
    stream.on("finish", () => {
      res.status(200).json({
        message: "Invoice PDF generated",
        pdf_url: `http://localhost:5000/invoices/invoice-${invoiceNumber}.pdf`,
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate invoice PDF" });
  }
};
