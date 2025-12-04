import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { verifyToken } from "./middleware/verifyToken.js";
import { requireRole } from "./middleware/requireRole.js";

// ROUTES
import tenantsRoutes from "./routes/tenants.js";
import dashboardRoutes from "./routes/dashboard.js";
import modulesRoutes from "./routes/modules.js";
import authRoutes from "./routes/authRoutes.js";
import inventory from "./routes/inventoryRoutes.js";
import product from "./routes/productRoutes.js";
import subscriberRoutes from "./routes/subscriber.js";
import amcRoutes from "./routes/amc.js";
import reportRoutes from "./routes/reportRouter.js";
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
import reportRoutesTenant from "./routes/reportsDynamicRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import salaryRoutes from "./routes/salaryRoutes.js";  
import EmplopyeeDiscountRoutes from "./routes/EmplyeeDiscountRoutes.js";
import employeesRoutes from "./routes/employeesRoutes.js";

const app = express();

// Fix __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve invoices
app.use("/invoices", express.static(path.join(__dirname, "invoices")));

// CORS
const allowedOrigins = [
  "https://tenant-sphere.vercel.app",
  "http://localhost:8080",
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

/* ======================================================
   PUBLIC ROUTES (NO TOKEN)
====================================================== */
app.use("/api/auth", authRoutes);

/* ======================================================
   superadmin ONLY ROUTES
====================================================== */
app.use("/api/tenants",
  verifyToken,
  requireRole("superadmin"),
  tenantsRoutes
);
app.use("/api/notification",verifyToken,requireRole("superadmin"),  notificationRoutes);

app.use("/api/plans",
  verifyToken,
  requireRole("superadmin"),
  plansRouter
);
app.use("/api/users",verifyToken,requireRole("superadmin"), usersRouter);
app.use("/api/reports/dashboard",verifyToken,requireRole("superadmin"),  dashboardRoutes);
app.use("/api/subscriber",
  verifyToken,
  requireRole("superadmin"),
  subscriberRoutes
);

app.use("/api/amc",
  verifyToken,
  requireRole("superadmin"),
  amcRoutes
);

app.use("/api/reports",
  verifyToken,
  requireRole("superadmin"),
  reportRoutes
);
app.use("/api/subscription_amount_plans",
  verifyToken,
  requireRole("superadmin"),
  subscriptionAmountsRouter
);
app.use("/api/modules",
  verifyToken,
  requireRole("superadmin"),
  modulesRoutes
);

/* ======================================================
   TENANT OWNER ONLY ROUTES
====================================================== */
app.use("/api/settings",
  verifyToken,
  requireRole(["tenant", "staff"]),
  settingsRouter
);



app.use("/api/staff",
  verifyToken,
  requireRole("tenant"),
  staffRoutes
);

app.use("/api/accounts",
  verifyToken,
  requireRole("tenant"),
  accountsRoutes
);

app.use("/api/purchases",
  verifyToken,
  requireRole("tenant"),
  purchaseRoutes
);

app.use("/api/suppliers",
  verifyToken,
  requireRole("tenant"),
  supplierRoutes
);


/* ======================================================
   STAFF + TENANT (SHARED ACCESS)
====================================================== */

// Inventory (staff + tenant)
app.use("/api/inventory", verifyToken, inventory);

// Billing (staff + tenant)
app.use("/api/invoices", verifyToken, invoiceRoutes);
app.use("/api/billing", verifyToken, billingRoutes);

// Returns
app.use("/api/purchase_returns", verifyToken, purchaseReturnsRouter);
app.use("/api/sales_returns", verifyToken, salesReturnsRouter);

// Customers
app.use("/api/customers", verifyToken, customerRoutes);

// Loyalty
app.use("/api/loyalty-rules", verifyToken, loyaltyRoutes);

// Discounts
app.use("/api/discounts", verifyToken, discountRoutes);

// Products (no role restriction)
app.use("/api/products", product);
app.use("/api/tenantreport", verifyToken, reportRoutesTenant);
app.use("/api/employees/attendance",verifyToken, attendanceRoutes);
app.use("/api/employees/salary",verifyToken, salaryRoutes);
app.use("/api/employees/discount",verifyToken, EmplopyeeDiscountRoutes);
app.use("/api/employees", verifyToken,employeesRoutes);

// Notifications


// Users


/* ======================================================
   ROOT
====================================================== */
app.get("/", (req, res) => res.send("✅ Server running successfully"));

/* ======================================================
   START SERVER
====================================================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
