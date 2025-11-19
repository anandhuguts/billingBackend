import express from "express";
import { getPlans, createPlan, upsertPlanByName } from "../controllers/planController.js";

const router = express.Router();

// GET /api/plans  (optionally ?name=basic)
router.get("/", getPlans);

// POST /api/plans
router.post("/", createPlan);

// PUT /api/plans/:name  (set/update plan by name)
router.put("/:name", upsertPlanByName);

export default router;
