import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { getAllInvoices, deleteInvoice } from '../controllers/invoiceController.js';

const router = express.Router();

router.get('/', getAllInvoices);
router.delete('/:id', deleteInvoice);

export default router;
