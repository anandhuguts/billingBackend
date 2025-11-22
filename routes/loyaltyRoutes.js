import express from "express";
import { LoyaltyRulesController } from "../controllers/loyaltyRulesController.js";

const router = express.Router();

router.get("/active", LoyaltyRulesController.getActive);
router.get("/", LoyaltyRulesController.getAll);
router.post("/", LoyaltyRulesController.create);
router.put("/:id", LoyaltyRulesController.update);

export default router;
