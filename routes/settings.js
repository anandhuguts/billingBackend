import { Router } from "express";
import {
  getSettings,
  upsertSettings,
} from "../controllers/settingsController.js";
import { changePassword } from "../controllers/settingsController.js";

const router = Router();

// Fetch settings for a user (by user id)
router.get("/:id", getSettings);

// Create or update settings (body must include user_id)
router.post("/", upsertSettings);



router.post("/:id/change-password", changePassword);

export default router;
