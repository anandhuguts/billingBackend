import express from "express";
// Import controller functions from amcController
import {
  getAllAMCs,
  getAMCById,
  createAMC,
  updateAMC,
  deleteAMC,
} from "../controllers/amcController.js";

const router = express.Router();

// Route: GET /amc
// Purpose: fetch all annual maintenance contract records
router.get("/", getAllAMCs);

// Route: GET /amc/:id
// Purpose: fetch a single AMC record by its unique id
router.get("/:id", getAMCById);

// Route: POST /amc
// Purpose: create a new AMC record
router.post("/", createAMC);

// Route: PUT /amc/:id
// Purpose: update an existing AMC record
router.put("/:id", updateAMC);

// Route: DELETE /amc/:id
// Purpose: delete an AMC record
router.delete("/:id", deleteAMC);

export default router;
