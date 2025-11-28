import express from "express";
import {
  getDaybook,
  getLedger,
  getTrialBalance,
  getBalanceSheet,
  getVATReport,
  getProfitAndLoss,
} from "../controllers/accountsController.js";

const router = express.Router();

router.get("/daybook", getDaybook);
router.get("/ledger", getLedger);
router.get("/trial-balance", getTrialBalance);
router.get("/balance-sheet", getBalanceSheet);
router.get("/vat", getVATReport);
router.get("/pal", getProfitAndLoss);

export default router;
