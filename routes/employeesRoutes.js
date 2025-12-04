import express from "express";
import { EmployeesController } from "../controllers/EmployeesController.js";


const router = express.Router();

// -------------------------------
// EMPLOYEES CRUD
// -------------------------------
router.get("/", EmployeesController.getAll);
router.get("/:id", EmployeesController.getOne);
router.post("/", EmployeesController.create);
router.put("/:id", EmployeesController.update);
router.delete("/:id", EmployeesController.delete);

export default router;