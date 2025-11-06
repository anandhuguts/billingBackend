import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import tenantsRoutes from "./routes/tenants.js";
import dashboardRoutes from "./routes/dashboard.js";
import modulesRoutes from "./routes/modules.js";
import authRoutes from "./routes/authRoutes.js";
import inventory from "./routes/inventoryRoutes.js";
import product from './routes/productRoutes.js'
import { verifyToken } from "./middleware/verifyToken.js";
import subscriberRoutes from "./routes/subscriber.js";
import amcRoutes from "./routes/amc.js";
import reportRoutes from "./routes/reportRouter.js";
import billingRoutes from "./routes/billingRoutes.js";

const app = express();

// Configure CORS with sensible defaults and expose PDF headers so the frontend
// can read Content-Disposition / filename when downloading PDFs.
const corsOptions = {
  origin: process.env.FRONTEND_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // allow the browser to access these response headers (important for file name)
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
  // Enable credentials (cookies) only when explicitly configured
  credentials: process.env.CORS_ALLOW_CREDENTIALS === "true" ? true : false,
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/tenants",verifyToken, tenantsRoutes);
app.use("/reports/dashboard",verifyToken, dashboardRoutes);
app.use("/tenants",verifyToken, modulesRoutes); // modules routes nested under tenants
app.use("/api/auth", authRoutes);
app.use("/api/inventory", verifyToken, inventory);
app.use("/api/products", product);
// Subscriber/subscription related routes (payments)
app.use("/subscriber", subscriberRoutes);
// AMC (Annual Maintenance Contract) related routes
app.use("/amc", amcRoutes);
//report routes
app.use("/reports", reportRoutes);
app.use("/api/invoices", billingRoutes);
app.get("/", (req, res) => res.send("✅ Server running successfully"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
