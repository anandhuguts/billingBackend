import express from "express";
import { createInvoice } from "../controllers/BillingController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

router.post("/", verifyToken, createInvoice);

export default router;
