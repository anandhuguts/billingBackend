import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import tenantsRoutes from "./routes/tenants.js";
import dashboardRoutes from "./routes/dashboard.js";
import modulesRoutes from "./routes/modules.js";
import authRoutes from "./routes/authRoutes.js";
import subscriberRoutes from "./routes/subscriber.js";
import amcRoutes from "./routes/amc.js";

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/tenants", tenantsRoutes);
app.use("/reports/dashboard", dashboardRoutes);
app.use("/tenants", modulesRoutes); // modules routes nested under tenants
app.use("/api/auth", authRoutes);
// Subscriber/subscription related routes (payments)
app.use("/subscriber", subscriberRoutes);
// AMC (Annual Maintenance Contract) related routes
app.use("/amc", amcRoutes);

app.get("/", (req, res) => res.send("✅ Server running successfully"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
