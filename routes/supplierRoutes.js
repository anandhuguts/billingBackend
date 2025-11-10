import express from "express";
import {
  createSupplier,
  getSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} from "../controllers/supplierController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

router.post("/", verifyToken, createSupplier);
router.get("/", verifyToken, getSuppliers);
router.get("/:id", verifyToken, getSupplierById);
router.put("/:id", verifyToken, updateSupplier);
router.delete("/:id", verifyToken, deleteSupplier);

export default router;
