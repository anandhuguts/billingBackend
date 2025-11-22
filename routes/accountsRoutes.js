import express from "express";
import { DaybookController } from "../controllers/daybookController.js";
import { LedgerController } from "../controllers/ledgerController.js";
import { VatController } from "../controllers/vatController.js";

const router = express.Router();

/* -------------------- DAYBOOK -------------------- */
router.get("/daybook", DaybookController.getAll);
router.post("/daybook", DaybookController.create);

/* -------------------- LEDGER -------------------- */
router.get("/ledger", LedgerController.getAll);
router.get("/ledger/:account_id", LedgerController.getByAccount);

/* -------------------- VAT REPORT -------------------- */
router.get("/vat", VatController.getAll);
router.post("/vat/generate", VatController.generateForMonth);

export default router;
