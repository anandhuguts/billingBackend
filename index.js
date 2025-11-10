import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url"; // ✅ Needed to use __dirname with ES modules

// Import routes
import tenantsRoutes from "./routes/tenants.js";
import dashboardRoutes from "./routes/dashboard.js";
import modulesRoutes from "./routes/modules.js";
import authRoutes from "./routes/authRoutes.js";
import inventory from "./routes/inventoryRoutes.js";
import product from "./routes/productRoutes.js";
import { verifyToken } from "./middleware/verifyToken.js";
import subscriberRoutes from "./routes/subscriber.js";
import amcRoutes from "./routes/amc.js";
import reportRoutes from "./routes/reportRouter.js";
import billingRoutes from "./routes/billingRoutes.js";
import purchaseRoutes from "./routes/purchaseRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";

const app = express();

// ✅ Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve the generated invoices folder
app.use("/invoices", express.static(path.join(__dirname, "invoices")));

// Configure CORS with sensible defaults
const corsOptions = {
  origin: process.env.FRONTEND_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
  credentials: process.env.CORS_ALLOW_CREDENTIALS === "true" ? true : false,
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/tenants", verifyToken, tenantsRoutes);
app.use("/reports/dashboard", verifyToken, dashboardRoutes);
app.use("/tenants", verifyToken, modulesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/inventory", verifyToken, inventory);
app.use("/api/products", product);
app.use("/subscriber", subscriberRoutes);
app.use("/amc", amcRoutes);
app.use("/reports", reportRoutes);

// ✅ Billing route (after static invoices)
app.use("/api/invoices", billingRoutes);
app.use("/api/purchases",verifyToken,purchaseRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/invoices", verifyToken, invoiceRoutes);
app.get("/", (req, res) => res.send("✅ Server running successfully"));

// Server listen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
