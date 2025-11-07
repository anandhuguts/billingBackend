import express from "express";
import { createInvoice, generatePDF } from "../controllers/BillingController.js";
import { verifyToken } from "../middleware/verifyToken.js";


const router = express.Router();

router.post("/", verifyToken, createInvoice);


router.post("/generate-pdf",verifyToken,generatePDF );

export default router;
