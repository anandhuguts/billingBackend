import express from "express";
import { getSubscriptionAmounts } from "../controllers/subscriptionAmountsController.js";

const router = express.Router();

// GET / -> returns array of subscription amount records
router.get("/", getSubscriptionAmounts);

export default router;
