import express from "express";
import { DiscountRulesController } from "../controllers/discountRulesController.js";

const router = express.Router();

router.get("/", DiscountRulesController.getAll);
router.get("/active", DiscountRulesController.getActive);
router.post("/", DiscountRulesController.create);
router.put("/:id", DiscountRulesController.update);
router.put("/:id/deactivate", DiscountRulesController.deactivate);

export default router;
