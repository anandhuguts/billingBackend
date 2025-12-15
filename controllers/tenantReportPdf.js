import { sendPDF } from "../utils/pdfResponse.js";
import { supabase } from "../supabase/supabaseClient.js";

export const getSummaryPDF = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const businessName = req.user.full_name || "Business Report";

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // -----------------------------
    // FETCH DATA
    // -----------------------------
    const { data: sales = [] } = await supabase
      .from("invoices")
      .select("final_amount")
      .eq("tenant_id", tenantId)
      .gte("created_at", todayStr);

    const { data: purchases = [] } = await supabase
      .from("purchases")
      .select("total_amount")
      .eq("tenant_id", tenantId)
      .gte("created_at", todayStr);

    const totalSales = sales.reduce(
      (sum, s) => sum + Number(s.final_amount || 0),
      0
    );

    const totalPurchases = purchases.reduce(
      (sum, p) => sum + Number(p.total_amount || 0),
      0
    );

    const profit = totalSales - totalPurchases;

    // -----------------------------
    // PDF RESPONSE
    // -----------------------------
    sendPDF(res, "Daily_Summary_Report", (doc) => {
      /* =============================
         HEADER
      ============================== */
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(businessName, { align: "center" });

      doc
        .moveDown(0.5)
        .fontSize(14)
        .font("Helvetica")
        .text("Daily Summary Report", { align: "center" });

      doc
        .moveDown(0.5)
        .fontSize(10)
        .text(`Date: ${today.toDateString()}`, { align: "center" });

      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown();

      /* =============================
         SUMMARY SECTION
      ============================== */
      doc.fontSize(13).font("Helvetica-Bold").text("Financial Overview");
      doc.moveDown(0.5);

      doc.fontSize(11).font("Helvetica");

      const row = (label, value) => {
        doc
          .font("Helvetica")
          .text(label, 60, doc.y, { continued: true })
          .font("Helvetica-Bold")
          .text(value, { align: "right" });
        doc.moveDown(0.4);
      };

      row("Total Sales", `₹ ${totalSales.toFixed(2)}`);
      row("Total Purchases", `₹ ${totalPurchases.toFixed(2)}`);
      row(
        "Net Profit",
        `₹ ${profit.toFixed(2)}`
      );

      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown();

      /* =============================
         FOOTER
      ============================== */
      doc
        .fontSize(9)
        .font("Helvetica-Oblique")
        .text(
          "This is a system-generated report. No signature required.",
          { align: "center" }
        );
    });
  } catch (err) {
    console.error("Summary PDF Error:", err);
    res.status(500).json({ error: "PDF generation failed" });
  }
};


export const getStockPDF = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const businessName = req.user.full_name || "Business Report";

    const { data = [] } = await supabase
      .from("inventory")
      .select("quantity, products(name, selling_price)")
      .eq("tenant_id", tenantId);

    sendPDF(res, "Stock_Report", (doc) => {
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const marginLeft = 50;
      const marginRight = pageWidth - 50;
      const tableStartX = marginLeft;
      const tableEndX = marginRight;

      // Column positions
      const col = {
        product: marginLeft + 10,        // 60
        qty: marginLeft + 250,           // 300
        price: marginLeft + 320,         // 370
        value: marginLeft + 410,         // 460
      };

      const startY = 100; // After header
      const rowHeight = 20;
      const maxContentHeight = pageHeight - 100; // Leave space for footer

      let currentY = startY;

      /* =============================
         HEADER
      ============================== */
      doc.fontSize(20).font("Helvetica-Bold").text(businessName, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(16).font("Helvetica").text("Stock Inventory Report", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: "center" });
      doc.moveDown(2);

      currentY = doc.y;

      // Horizontal line under header
      doc.moveTo(tableStartX, currentY).lineTo(tableEndX, currentY).stroke();
      currentY += 10;

      /* =============================
         DRAW TABLE HEADER
      ============================== */
      const drawTableHeader = () => {
        doc.font("Helvetica-Bold").fontSize(11);

        doc.text("Product", col.product, currentY, { width: 230 });
        doc.text("Qty", col.qty, currentY, { width: 60, align: "right" });
        doc.text("Unit Price", col.price, currentY, { width: 80, align: "right" });
        doc.text("Stock Value", col.value, currentY, { width: 80, align: "right" });

        currentY += rowHeight;

        // Underline for header
        doc.moveTo(tableStartX, currentY - 4).lineTo(tableEndX, currentY - 4).lineWidth(1).stroke();

        doc.font("Helvetica").fontSize(10); // Reset for body
      };

      drawTableHeader(); // First page header

      /* =============================
         TABLE ROWS
      ============================== */
      let totalValue = 0;

      for (const item of data) {
        // Check if we need a new page
        if (currentY + rowHeight > maxContentHeight - 60) { // Leave space for total + footer
          doc.addPage();

          // Reset Y and redraw header on new page
          currentY = 70;
          drawTableHeader();
        }

        const name = item.products?.name || "Unknown Product";
        const qty = Number(item.quantity || 0);
        const price = Number(item.products?.selling_price || 0);
        const value = qty * price;

        totalValue += value;

        // Highlight low stock in red
        doc.fillColor(qty < 10 ? "#d32f2f" : "black");

        doc.text(name, col.product, currentY, {
          width: 230,
          ellipsis: true,
        });
        doc.text(qty.toString(), col.qty, currentY, {
          width: 60,
          align: "right",
        });
        doc.text(`₹ ${price.toFixed(2)}`, col.price, currentY, {
          width: 80,
          align: "right",
        });
        doc.text(`₹ ${value.toFixed(2)}`, col.value, currentY, {
          width: 80,
          align: "right",
        });

        currentY += rowHeight;
      }

      doc.fillColor("black");

      /* =============================
         TOTAL SECTION
      ============================== */
      // Ensure space for total
      if (currentY + 60 > maxContentHeight) {
        doc.addPage();
        currentY = 70;
      }

      currentY += 15;

      // Line above total
      doc.moveTo(tableStartX, currentY).lineTo(tableEndX, currentY).stroke();
      currentY += 15;

      doc.font("Helvetica-Bold").fontSize(13);
      doc.text("Total Inventory Value:", col.qty - 100, currentY, {
        width: 200,
        align: "right",
      });
      doc.text(`₹ ${totalValue.toFixed(2)}`, col.value, currentY, {
        width: 80,
        align: "right",
      });

      currentY += 40;

      /* =============================
         FOOTER
      ============================== */
      const footerText = "Low stock items (<10) are highlighted in red. This is a system-generated report.";
      doc.fontSize(9).font("Helvetica-Oblique").fillColor("#555555");
      doc.text(footerText, marginLeft, pageHeight - 60, {
        width: pageWidth - 100,
        align: "center",
      });

      // Optional: Page number
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(9).fillColor("#888888");
        doc.text(`Page ${i + 1} of ${pageCount}`, marginLeft, pageHeight - 40, {
          width: pageWidth - 100,
          align: "center",
        });
      }
    });
  } catch (err) {
    console.error("Stock PDF Error:", err);
    res.status(500).json({ error: "Failed to generate stock PDF" });
  }
};


export const getProfitPDF = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const businessName = req.user.full_name || "Business Report";

    const { data = [] } = await supabase
      .from("invoice_items")
      .select("quantity, price, products(name, cost_price)")
      .eq("tenant_id", tenantId);

    sendPDF(res, "Profit_Report", (doc) => {
      /* =============================
         HEADER
      ============================== */
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(businessName, { align: "center" });

      doc
        .moveDown(0.5)
        .fontSize(14)
        .font("Helvetica")
        .text("Product-wise Profit Report", { align: "center" });

      doc
        .moveDown(0.5)
        .fontSize(10)
        .text(`Generated on: ${new Date().toDateString()}`, {
          align: "center",
        });

      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown();

      /* =============================
         TABLE HEADER
      ============================== */
      const startX = 50;

      doc.fontSize(11).font("Helvetica-Bold");
      doc.text("Product", startX, doc.y);
      doc.text("Qty", 260, doc.y, { width: 50, align: "right" });
      doc.text("Revenue", 320, doc.y, { width: 80, align: "right" });
      doc.text("Cost", 410, doc.y, { width: 70, align: "right" });
      doc.text("Profit", 490, doc.y, { width: 70, align: "right" });

      doc.moveDown(0.3);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.5);

      /* =============================
         TABLE ROWS
      ============================== */
      doc.font("Helvetica").fontSize(10);

      let totalRevenue = 0;
      let totalCost = 0;
      let totalProfit = 0;

      data.forEach((item) => {
        const name = item.products?.name || "-";
        const qty = Number(item.quantity || 0);
        const revenue = Number(item.price || 0) * qty;
        const cost =
          Number(item.products?.cost_price || 0) * qty;
        const profit = revenue - cost;

        totalRevenue += revenue;
        totalCost += cost;
        totalProfit += profit;

        // Highlight loss-making items
        if (profit < 0) {
          doc.fillColor("red");
        } else {
          doc.fillColor("black");
        }

        doc.text(name, startX, doc.y);
        doc.text(qty.toString(), 260, doc.y, {
          width: 50,
          align: "right",
        });
        doc.text(`₹ ${revenue.toFixed(2)}`, 320, doc.y, {
          width: 80,
          align: "right",
        });
        doc.text(`₹ ${cost.toFixed(2)}`, 410, doc.y, {
          width: 70,
          align: "right",
        });
        doc.text(`₹ ${profit.toFixed(2)}`, 490, doc.y, {
          width: 70,
          align: "right",
        });

        doc.moveDown(0.4);
      });

      doc.fillColor("black");
      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.6);

      /* =============================
         TOTALS
      ============================== */
      doc.font("Helvetica-Bold").fontSize(12);

      doc.text("Total Revenue", 300, doc.y, { continued: true });
      doc.text(`₹ ${totalRevenue.toFixed(2)}`, { align: "right" });

      doc.text("Total Cost", 300, doc.y, { continued: true });
      doc.text(`₹ ${totalCost.toFixed(2)}`, { align: "right" });

      doc.text("Net Profit", 300, doc.y, { continued: true });
      doc.text(`₹ ${totalProfit.toFixed(2)}`, { align: "right" });

      doc.moveDown();

      /* =============================
         FOOTER
      ============================== */
      doc
        .fontSize(9)
        .font("Helvetica-Oblique")
        .text(
          "Negative profit values indicate loss. This is a system-generated report.",
          { align: "center" }
        );
    });
  } catch (err) {
    console.error("Profit PDF Error:", err);
    res.status(500).json({ error: "Profit PDF failed" });
  }
};


