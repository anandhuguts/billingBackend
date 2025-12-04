import bcrypt from "bcrypt";
import { supabase } from "../supabase/supabaseClient.js";

export const StaffController = {

  /* ============================
       GET ALL STAFF USERS
  ============================ */
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("tenant_id", tenant_id)
        .eq("role", "staff")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },


  /* ============================
       CREATE STAFF USER + EMPLOYEE
  ============================ */
  async create(req, res) {
    try {
      const { full_name, email, password, salary, phone, position } = req.body;
      const { tenant_id } = req.user;

      if (!full_name || !email || !password) {
        return res.status(400).json({ error: "Required fields missing" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // 1️⃣ Create user (login account)
      const { data: userRows, error: userErr } = await supabase
        .from("users")
        .insert([
          {
            full_name,
            email,
            password: hashedPassword,
            role: "staff",
            tenant_id,
            is_active: true,
          },
        ])
        .select();

      if (userErr) throw userErr;

      const user = userRows[0];

      // 2️⃣ Create employee record
      const { error: empErr } = await supabase
        .from("employees")
        .insert([
          {
            id: user.id,        // same UUID
            tenant_id,
            full_name,
            phone: phone || "",
            position: position || "Staff",
            salary: salary || 0,
          },
        ]);

      if (empErr) throw empErr;

      return res.json({
        success: true,
        message: "Staff & employee created",
        data: user
      });

    } catch (error) {
      console.error("Staff create error:", error);
      return res.status(500).json({ error: error.message });
    }
  },


  /* ============================
       UPDATE STAFF + EMPLOYEE
  ============================ */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { full_name, role, is_active, salary, phone, position } = req.body;
      const { tenant_id } = req.user;

      // Update users table
      const { error: userErr } = await supabase
        .from("users")
        .update({ full_name, role, is_active })
        .match({ id, tenant_id });

      if (userErr) throw userErr;

      // Update employees table
      const { error: empErr } = await supabase
        .from("employees")
        .update({ full_name, salary, phone, position })
        .match({ id, tenant_id });

      if (empErr) throw empErr;

      return res.json({ success: true, message: "Staff updated" });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },


  /* ============================
       DELETE STAFF + EMPLOYEE
  ============================ */
  async delete(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      // 1️⃣ Delete employee record
      await supabase
        .from("employees")
        .delete()
        .match({ id, tenant_id });

      // 2️⃣ Delete user login
      await supabase
        .from("users")
        .delete()
        .match({ id, tenant_id });

      return res.json({ success: true, message: "Staff removed" });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
