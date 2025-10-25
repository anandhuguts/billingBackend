import express from "express";
import {
  getModulesForTenant,
  updateModulesForTenant
} from "../controllers/modulesController.js";

const router = express.Router();

router.get("/:id/modules", getModulesForTenant);
router.put("/:id/modules", updateModulesForTenant);

export default router;
