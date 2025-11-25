import express from "express";
import tenantReportController from "../controllers/tenantReportController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

// GET / -> timeseries report for tenant
router.get("/", verifyToken, tenantReportController.getTenantReport);

export default router;
