import { Router } from "express";
import {
  getAllPurchaseReturns,
  getPurchaseReturnById,
  createPurchaseReturn,
  updatePurchaseReturn,
  deletePurchaseReturn,
} from "../controllers/returnPurchaseController.js";

const router = Router();

router.get("/", getAllPurchaseReturns);          // GET /purchase_returns?tenant_id=...
router.get("/:id", getPurchaseReturnById);       // GET /purchase_returns/:id
router.post("/", createPurchaseReturn);          // POST /purchase_returns
router.put("/:id", updatePurchaseReturn);        // PUT /purchase_returns/:id
router.delete("/:id", deletePurchaseReturn);     // DELETE /purchase_returns/:id

export default router;