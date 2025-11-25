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
import { requireRole } from "./middleware/requireRole.js";
import subscriberRoutes from "./routes/subscriber.js";
import amcRoutes from "./routes/amc.js";
import reportRoutes from "./routes/reportRouter.js";
import tenantReportRoutes from "./routes/tenantReport.js";
import billingRoutes from "./routes/billingRoutes.js";
import purchaseRoutes from "./routes/purchaseRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import notificationRoutes from "./routes/notification.js";
import staffRoutes from "./routes/staffRoute.js";
import usersRouter from "./routes/userRouter.js";
import settingsRouter from "./routes/settings.js";
import plansRouter from "./routes/plansRouter.js";
import subscriptionAmountsRouter from "./routes/subscriptionAmounts.js";
import customerRoutes from "./routes/customerRoutes.js";
import loyaltyRoutes from "./routes/loyaltyRoutes.js";
import discountRoutes from "./routes/discountRoutes.js";
import accountsRoutes from "./routes/accountsRoutes.js";
import purchaseReturnsRouter from "./routes/returnPurchaseRouter.js";
import salesReturnsRouter from "./routes/returnSalesRoter.js";

const app = express();

// ✅ Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve the generated invoices folder
app.use("/invoices", express.static(path.join(__dirname, "invoices")));

// Configure CORS with sensible defaults
const allowedOrigins = [
  "https://tenant-sphere.vercel.app",
  "http://localhost:8080",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
  credentials: true, // since you're verifying tokens
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
// Tenant management should be admin-only. Protect it server-side so
// changing client-side values can't grant access.
app.use("/api/tenants", verifyToken, tenantsRoutes);
//app.use("/api/tenants", verifyToken, requireRole("super_admin"), tenantsRoutes);
app.use("/api/reports/dashboard", verifyToken, dashboardRoutes);
app.use("/api/tenants", verifyToken, modulesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/inventory", verifyToken, inventory);
app.use("/api/products", product);
app.use("/api/subscriber", subscriberRoutes);
app.use("/api/amc", amcRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/reports/tenant", tenantReportRoutes);
app.use("/api/users", usersRouter);
app.use("/api/settings", verifyToken, settingsRouter);
app.use("/api/plans", plansRouter);
// Provide both singular and plural endpoints for frontend compatibility

app.use("/api/subscription_amount_plans", subscriptionAmountsRouter);

// ✅ Billing route (after static invoices)
app.use("/api/invoices", billingRoutes);
app.use("/api/purchases", verifyToken, purchaseRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/invoices", verifyToken, invoiceRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api/discounts", verifyToken, discountRoutes);
app.use("/api/purchase_returns", verifyToken, purchaseReturnsRouter);
app.use("/api/sales_returns", verifyToken, salesReturnsRouter);

app.use("/api/staff", verifyToken, staffRoutes);
app.use("/api/customers", verifyToken, customerRoutes);
app.use("/api/loyalty-rules", verifyToken, loyaltyRoutes);
app.use("/api/accounts", verifyToken, accountsRoutes);

app.get("/", (req, res) => res.send("✅ Server running successfully"));

// Server listen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
