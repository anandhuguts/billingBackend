import express from "express";
import { SalaryController } from "../controllers/SalaryController.js";


const router = express.Router();

// Pay salary
router.post("/pay",  SalaryController.paySalary);

// Get salary of one employee
router.get("/:employee_id",  SalaryController.getEmployeeSalary);

// Get all salary history
router.get("/",  SalaryController.getAll);
router.get("/check/:employee_id", SalaryController.checkSalaryPaid);


export default router;
