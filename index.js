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

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/tenants",verifyToken, tenantsRoutes);
app.use("/reports/dashboard",verifyToken, dashboardRoutes);
app.use("/tenants",verifyToken, modulesRoutes); // modules routes nested under tenants
app.use("/api/auth", authRoutes);
app.use("/api/inventory", verifyToken, inventory);
app.use("/api/products", product);

app.get("/", (req, res) => res.send("✅ Server running successfully"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
