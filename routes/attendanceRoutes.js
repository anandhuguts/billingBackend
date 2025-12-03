import express from "express";
import { AttendanceController } from "../controllers/attendanceController.js";


const router = express.Router();

// Check-in
router.post("/checkin", AttendanceController.checkIn);

// Check-out
router.post("/checkout", AttendanceController.checkOut);

// Get all attendance
router.get("/",  AttendanceController.getAllAttendance);

// Get attendance of one employee
router.get("/:employee_id", AttendanceController.getAttendanceByEmployee);

export default router;
