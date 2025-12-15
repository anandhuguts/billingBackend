import express from "express";
import {
  getSummaryPDF,
  getStockPDF,
  getProfitPDF,
} from "../controllers/tenantReportPdf.js";

const router = express.Router();

router.get("/summary/pdf", getSummaryPDF);
router.get("/stock/pdf", getStockPDF);
router.get("/profit/pdf", getProfitPDF);

export default router;
