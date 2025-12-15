import PDFDocument from "pdfkit";

export function sendPDF(res, title, buildContent) {
  const doc = new PDFDocument({ margin: 30, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${title}.pdf"`
  );

  doc.pipe(res);

  // Header
  doc.fontSize(18).text(title, { align: "center" });
  doc.moveDown();

  // Custom content injected
  buildContent(doc);

  doc.end();
}
