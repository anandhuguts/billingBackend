import { Router } from "express";
import {
  getAllSalesReturns,
  getSalesReturnById,
  createSalesReturn,
  updateSalesReturn,
  deleteSalesReturn
} from "../controllers/returnSalesController.js";

// Optionally import auth:
// import { verifyToken } from "../middleware/verifyToken.js";
// import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// If protected, prepend verifyToken (and role) to each route.
router.get("/", getAllSalesReturns);
router.get("/:id", getSalesReturnById);
router.post("/", createSalesReturn);
router.put("/:id", updateSalesReturn);
router.delete("/:id", deleteSalesReturn);

export default router;