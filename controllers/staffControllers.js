import bcrypt from "bcrypt";
import { supabase } from "../supabase/supabaseClient.js";

export const StaffController = {
  // LIST staff
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("tenant_id", tenant_id)
        .neq("role", "tenant")
        .neq("role", "superadmin")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // CREATE staff
  // CREATE staff
// CREATE staff
async create(req, res) {
  try {
    const { full_name, email, password, role, is_active } = req.body;
    const { tenant_id } = req.user;

    console.log("Incoming body:", req.body);
    console.log("Tenant ID:", tenant_id);

    // Basic validation
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert staff
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          full_name,
          email,
          password: hashedPassword,
          role: role || "staff",
          tenant_id,
          is_active: is_active ?? true,
        },
      ])
      .select("id, full_name, email, role, is_active"); // forces RETURNING

    console.log("Supabase error:", error);
    console.log("Supabase data:", data);

    // Duplicate email error
    if (error && error.code === "23505") {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Other insert error
    if (error) {
      throw error;
    }

    // Supabase sometimes inserts but returns null (RETURNING disabled)
    if (!data || data.length === 0) {
      return res.json({
        success: true,
        message: "Staff created successfully",
      });
    }

    // Success with returned row
    return res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: error.message });
  }
},

  // UPDATE staff
  async update(req, res) {
    try {
      const { id } = req.params;
      const { full_name, role, is_active } = req.body;
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("users")
        .update({ full_name, role, is_active })
        .match({ id, tenant_id })
        .select();

      if (error) throw error;

      return res.json({ success: true, data: data[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE staff
  async delete(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      const { error } = await supabase
        .from("users")
        .delete()
        .match({ id, tenant_id });

      if (error) throw error;

      return res.json({ success: true, message: "Staff removed" });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
