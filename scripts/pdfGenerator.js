import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export const generatePDF = ({ invoiceNumber, items, total, payment_method, subtotal }) => {

    const baseUrl = `${req.protocol}://${req.get("host")}`;

  return new Promise((resolve, reject) => {
    try {
      const invoicesDir = path.join(process.cwd(), "invoices");
      if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

      const filePath = path.join(invoicesDir, `invoice-${invoiceNumber}.pdf`);

      // 80mm thermal width
      const doc = new PDFDocument({
        size: [226, 600],
        margin: 10,
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      let y = 10;

      const center = (text, size = 10, font = "Courier") => {
        doc.font(font).fontSize(size);
        doc.text(text, 0, y, { width: 226, align: "center" });
        y += size + 2;
      };

      const line = () => {
        doc
          .font("Courier")
          .fontSize(9)
          .text("----------------------------------------", 0, y, {
            width: 226,
            align: "center",
          });
        y += 12;
      };

      const starLine = () => {
        doc
          .font("Courier")
          .fontSize(10)
          .text("********************************", 0, y, {
            width: 226,
            align: "center",
          });
        y += 14;
      };

      // TOP
      starLine();
      center("SUPERMART", 16);
      starLine();

      // Invoice meta
      doc.font("Courier").fontSize(9).text(`Invoice No: ${invoiceNumber}`, 10, y);
      y += 12;

      doc
        .font("Courier")
        .fontSize(9)
        .text(`Date: ${new Date().toLocaleString()}`, 10, y);

      y += 14;

      line();

      // ITEMS
      doc.font("Courier").fontSize(10);

      items.forEach((item) => {
        const name = `${item.quantity}x ${item.name}`;
        const price = `AED ${Number(item.total).toFixed(2)}`;

        doc.text(name, 10, y);
        doc.text(price, -10, y, { align: "right" });
        y += 14;
      });

      y += 2;
      line();

      // TOTAL
      doc.font("Courier-Bold").fontSize(11);
      doc.text("TOTAL:", 10, y);
      doc.text(`AED ${Number(total).toFixed(2)}`, -10, y, { align: "right" });
      y += 16;

      // Payment Method
      doc.font("Courier").fontSize(10);
      doc.text("Payment Method:", 10, y);
      doc.text(payment_method.toUpperCase(), -10, y, { align: "right" });
      y += 14;

      line();

      // Thank you message
      center("********* THANK YOU! *********", 10);
      y += 10;

      // Barcode mimic
      const barStartX = 40;
      for (let i = 0; i < 40; i++) {
        const x = barStartX + i * 2.2;
        const lineW = Math.random() > 0.5 ? 1.2 : 0.6;
        doc.moveTo(x, y).lineTo(x, y + 25).lineWidth(lineW).stroke();
      }

      doc.end();

      stream.on("finish", () => {
     resolve(`${baseUrl}/invoices/invoice-${invoiceNumber}.pdf`);
      });

    } catch (err) {
      reject(err);
    }
  });
};
