import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import {
createCategory,
getCategories,
updateCategory,
deleteCategory
} from "../controllers/categoryController.js";

const router = express.Router();

router.post("/", verifyToken, createCategory);
router.get("/", verifyToken, getCategories);
router.get("/:id", verifyToken,updateCategory);
router.put("/:id", verifyToken,deleteCategory);


export default router;
