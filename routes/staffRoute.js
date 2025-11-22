import { Router } from "express";

import { StaffController } from "../controllers/staffControllers.js";

const router = Router();

// /api/staff
router.get("/", StaffController.getAll);
router.post("/",StaffController.create);
router.put("/:id", StaffController.update);
router.delete("/:id",StaffController.delete);

export default router;
