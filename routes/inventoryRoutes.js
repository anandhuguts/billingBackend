import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import * as inv from "../controllers/inventoryController.js";

const router = express.Router();
router.use(verifyToken);

router.post("/", inv.createInventory);
router.get("/", inv.getInventory);
router.put("/:id", inv.updateInventory);
router.delete("/:id", inv.deleteInventory);

export default router;
