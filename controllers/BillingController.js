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
    const { items = [], payment_method = "cash" } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // 🧮 Step 1 — Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const tax_total = items.reduce(
      (sum, item) => sum + (item.price * item.tax / 100) * item.qty,
      0
    );
    const total_amount = subtotal + tax_total;

    // 🧾 Step 2 — Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert([
        {
          tenant_id,
          total_amount,
          payment_method,
        },
      ])
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    console.log("Created invoice:", invoice);

    // 🧩 Step 3 — Insert invoice items (✅ FIXED HERE)
    const invoiceItems = items.map((item) => ({
      tenant_id,
      invoice_id: invoice.id,
      product_id: item.product_id, // ✅ CORRECT FIELD
      quantity: item.qty,
      price: item.price,
      tax: item.tax,
      total: item.total,
    }));

    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(invoiceItems);

    if (itemsError) throw itemsError;

    // 📦 Step 4 — Update inventory
    const lowStockAlerts = [];

    for (const item of items) {
      const { data: invData, error: invErr } = await supabase
        .from("inventory")
        .select("id, quantity, reorder_level, max_stock, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", item.product_id) // ✅ FIXED
        .single();

      if (invErr || !invData) {
        console.warn(`⚠️ Inventory not found for product_id: ${item.product_id}. Creating new entry...`);

        const { error: createErr } = await supabase.from("inventory").insert([
          {
            tenant_id,
            product_id: item.product_id, // ✅ FIXED
            quantity: 0,
            reorder_level: 5,
            max_stock: 100,
          },
        ]);

        if (createErr) {
          console.error(`❌ Failed to create inventory record for product_id: ${item.product_id}`, createErr);
        }

        continue;
      }

      const newQty = Math.max(0, (invData.quantity || 0) - item.qty);

      const { error: updateErr } = await supabase
        .from("inventory")
        .update({ quantity: newQty })
        .eq("id", invData.id)
        .eq("tenant_id", tenant_id);

      if (updateErr) {
        console.error(`Failed to update stock for product_id ${item.product_id}`, updateErr);
        continue;
      }

      if (newQty <= (invData.reorder_level || 0)) {
        lowStockAlerts.push({
          product_id: item.product_id, // ✅ FIXED
          newQty,
          reorder_level: invData.reorder_level,
        });
      }
    }

    // 🧾 Step 5 — Fetch the generated invoice_number from DB
    const { data: updatedInvoice, error: fetchError } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount, payment_method, created_at")
      .eq("id", invoice.id)
      .single();

    if (fetchError) throw fetchError;

    // ✅ Step 6 — Return response
    return res.status(201).json({
      message: "Invoice created successfully",
      invoice: updatedInvoice,
      items: invoiceItems,
      lowStockAlerts,
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
