// routes/reportRoutes.js
import express from "express";
import {
  generatePdfReport,
  generatePdfForTenant,
  generatePdfForUser,
  generatePdfForPayment,
  exportReport,
} from "../controllers/reportController.js";

const router = express.Router();

router.get("/export/all-data", generatePdfReport); // GET returns PDF
// Individual scoped reports
router.get("/export/tenant/:id", generatePdfForTenant);
router.get("/export/user/:id", generatePdfForUser);
router.get("/export/payment/:id", generatePdfForPayment);
// CSV/export endpoint (query params)
router.get("/export", exportReport);

export default router;
