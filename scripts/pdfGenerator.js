import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";



export const generatePDF = ({
  invoiceNumber,
  items,
  total,
  payment_method,
  subtotal,
  businessName
}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [226, 800],
        margin: 10,
      });

      let chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      let y = 10;

      // Helpers
      const center = (text, size = 11, bold = false) => {
        doc.font(bold ? "Courier-Bold" : "Courier");
        doc.fontSize(size);
        doc.text(text, 0, y, { width: 226, align: "center" });
        y += size + 4;
      };

      const leftRight = (left, right, size = 10) => {
        doc.font("Courier").fontSize(size);
        doc.text(left, 10, y);
        doc.text(right, -10, y, { align: "right" });
        y += size + 4;
      };

      const dashed = () => {
        doc.font("Courier").fontSize(9);
        doc.text("----------------------------------------", 0, y, {
          width: 226,
          align: "center",
        });
        y += 12;
      };

      const stars = () => {
        doc.font("Courier").fontSize(10);
        doc.text("********************************", 0, y, {
          width: 226,
          align: "center",
        });
        y += 14;
      };

      // HEADER
      stars();
      center(businessName || "SUPERMART", 16, true);
      stars();

      leftRight("Invoice No:", invoiceNumber);
      leftRight("Date:", new Date().toLocaleString());

      dashed();

      // ITEMS
      doc.font("Courier-Bold").fontSize(10);
      leftRight("ITEM", "AMOUNT");

      doc.font("Courier").fontSize(10);

      items.forEach((item) => {
        const qtyName = `${item.quantity}x ${item.name}`;
        const priceText = `AED ${Number(item.total).toFixed(2)}`;
        leftRight(qtyName, priceText);
      });

      dashed();

      // TOTALS
      doc.font("Courier-Bold").fontSize(11);
      leftRight("TOTAL", `AED ${Number(total).toFixed(2)}`, 12);

      doc.font("Courier").fontSize(10);
      leftRight("Payment:", payment_method.toUpperCase());

      dashed();

      // FOOTER
      center("********* THANK YOU! *********", 11, true);

      y += 5;

      // Generate barcode lines
      const barcodeWidth = 40 * 2.2;
      const startX = (226 - barcodeWidth) / 2;

      for (let i = 0; i < 40; i++) {
        const x = startX + i * 2.2;
        const lineW = Math.random() > 0.5 ? 1.2 : 0.6;
        doc.moveTo(x, y).lineTo(x, y + 25).lineWidth(lineW).stroke();
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
