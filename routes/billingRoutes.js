import express from "express";
import { createInvoice} from "../controllers/BillingController.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { generatePDF } from "../scripts/pdfGenerator.js";


const router = express.Router();

router.post("/", verifyToken, createInvoice);


router.post("/generate-pdf",verifyToken,generatePDF );

export default router;
