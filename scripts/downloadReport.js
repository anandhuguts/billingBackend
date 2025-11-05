#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";

// Simple script to download the PDF report from the running server and save it to disk.
// Usage:
//   REPORT_URL="http://localhost:5000/reports/export/all-data" OUT_FILE=report.pdf node scripts/downloadReport.js
// If your server requires auth, set AUTH_TOKEN env var to a Bearer token.

const url =
  process.env.REPORT_URL ||
  `http://localhost:${process.env.PORT || 5000}/reports/export/all-data`;
const outFile =
  process.env.OUT_FILE ||
  path.resolve(process.cwd(), `full-report-${Date.now()}.pdf`);
const token = process.env.AUTH_TOKEN;

const headers = { Accept: "application/pdf" };
if (token) headers["Authorization"] = `Bearer ${token}`;

(async () => {
  try {
    console.log("Fetching report from", url);
    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      const contentType = res.headers.get("content-type") || "";
      let body = "";
      try {
        body = contentType.includes("application/json")
          ? JSON.stringify(await res.json())
          : await res.text();
      } catch (e) {
        body = "<unreadable response body>";
      }
      console.error(
        "Failed to fetch report:",
        res.status,
        res.statusText,
        body
      );
      process.exit(2);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(outFile, buffer);
    console.log("Saved report to", outFile);
    process.exit(0);
  } catch (err) {
    console.error("Error downloading report:", err);
    process.exit(1);
  }
})();
