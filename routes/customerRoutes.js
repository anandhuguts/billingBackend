import express from "express";
import { CustomerController } from "../controllers/customerController.js";

const router = express.Router();

router.get("/", CustomerController.getAll);
router.post("/", CustomerController.create);
router.get("/:id", CustomerController.getOne);
router.put("/:id", CustomerController.update);
router.delete("/:id", CustomerController.delete);
router.get("/search/:keyword", CustomerController.search);

export default router;
