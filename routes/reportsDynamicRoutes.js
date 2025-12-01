import express from "express";
import {
  getReportSummary,
  getSalesChart,
  getPurchaseChart,
  getStockReport,
  getProfitReport,
  getPaymentSummary,
  getAnalyticsReport
} from "../controllers/reportsDynamicController.js";

import { verifyToken } from "../middleware/verifyToken.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

// All staff + tenant can view reports
router.get("/summary", verifyToken, getReportSummary);
router.get("/sales-chart", verifyToken, getSalesChart);
router.get("/purchase-chart", verifyToken, getPurchaseChart);
router.get("/stock-report", verifyToken, getStockReport);
router.get("/profit-report", verifyToken, getProfitReport);
router.get("/payment-summary", verifyToken, getPaymentSummary);
router.get("/analytics", verifyToken, getAnalyticsReport);

export default router;
