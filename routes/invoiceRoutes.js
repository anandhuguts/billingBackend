import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { getAllInvoices, deleteInvoice, previewInvoice } from '../controllers/invoiceController.js';

const router = express.Router();

router.get('/', getAllInvoices);
router.delete('/:id', deleteInvoice);
router.post("/preview", verifyToken, previewInvoice);


export default router;
