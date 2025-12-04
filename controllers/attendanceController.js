// controllers/attendanceController.js
import { supabase } from "../supabase/supabaseClient.js";

export const AttendanceController = {

  async checkIn(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const employee_id = req.user.employee_id;

      if (!employee_id) {
        return res.status(400).json({ error: "Employee record not linked" });
      }

      const today = new Date().toISOString().split("T")[0];

      const { data: existing } = await supabase
        .from("employee_attendance")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .eq("date", today)
        .maybeSingle();

      if (existing?.check_in) {
        return res.status(400).json({ error: "Already checked in" });
      }

      const { data, error } = await supabase
        .from("employee_attendance")
        .insert([
          {
            tenant_id,
            employee_id,
            date: today,
            check_in: new Date(),
            status: "present",
          },
        ])
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.json({ success: true, data });

    } catch (err) {
      console.error("checkIn error:", err);
      return res.status(500).json({ error: err.message });
    }
  },


  async checkOut(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const employee_id = req.user.employee_id;

      if (!employee_id) {
        return res.status(400).json({ error: "Employee record not linked" });
      }

      const today = new Date().toISOString().split("T")[0];

      const { data: row } = await supabase
        .from("employee_attendance")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .eq("date", today)
        .maybeSingle();

      if (!row) {
        return res.status(404).json({ error: "No check-in found" });
      }

      const checkInTime = new Date(row.check_in);
      const now = new Date();

      const diff = now - checkInTime;
      const total_hours = Number((diff / 36e5).toFixed(2));

      const { data, error } = await supabase
        .from("employee_attendance")
        .update({
          check_out: now,
          total_hours,
        })
        .eq("id", row.id)
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.json({ success: true, data });

    } catch (err) {
      console.error("checkOut error:", err);
      return res.status(500).json({ error: err.message });
    }
  },


  async getAllAttendance(req, res) {
    try {
      const tenant_id = req.user.tenant_id;

      const { data, error } = await supabase
        .from("employee_attendance")
        .select("*, employees(full_name, position)")
        .eq("tenant_id", tenant_id)
        .order("date", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },


  async getAttendanceByEmployee(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const employee_id = req.params.employee_id;

      const { data, error } = await supabase
        .from("employee_attendance")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", employee_id)
        .order("date", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },
};
