import express from "express";
import {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
 getTenantDetails,
} from "../controllers/tenantsController.js";

const router = express.Router();

router.get("/", getAllTenants);
router.get("/:id", getTenantById);
router.get("/:id/details", getTenantDetails);
router.post("/", createTenant);
router.put("/:id", updateTenant);
router.delete("/:id", deleteTenant);

export default router;
