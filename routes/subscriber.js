import express from "express";
// Import controller functions from subscriberController
import {
  getPaymentsByTenant,
  createPayment,
  getAllPayments,
} from "../controllers/subscriberController.js";

const router = express.Router();

// Route: GET /subscriber/:id/payments
// Purpose: fetch payments for a single tenant by tenant id
router.get("/:id/payments", getPaymentsByTenant);

// Route: POST /subscriber/payments
// Purpose: create/record a payment for a tenant
router.post("/payments", createPayment);

// Route: GET /subscriber/payments (admin/all)
// Purpose: fetch all payments across tenants — keep this for admin/debugging
router.get("/payments", getAllPayments);

export default router;
