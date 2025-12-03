import express from "express";
import { EmployeeDiscountController } from "../controllers/emplyeeDiscountController.js";


const router = express.Router();

// Set employee discount rule
router.post("/rule",EmployeeDiscountController.setRule);

// Get discount rule
router.get("/rule",EmployeeDiscountController.getRule);

// Apply employee discount during billing
router.post("/apply",EmployeeDiscountController.apply);

// Get employee discount usage
router.get("/usage/:employee_id",EmployeeDiscountController.getUsage);

export default router;
