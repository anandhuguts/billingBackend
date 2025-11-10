import express from "express";
import {
  getAllPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
  getPurchaseStats
} from '../controllers/purchaseController.js';
import { verifyToken } from "../middleware/verifyToken.js"; // if using JWT auth

const router = express.Router();

router.get('/', getAllPurchases);
router.get('/stats', getPurchaseStats);
router.get('/:id', getPurchaseById);
router.post('/', createPurchase);
router.put('/:id', updatePurchase);
router.delete('/:id', deletePurchase);

export default router;
