// controllers/EmployeesController.js
import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";

export const EmployeesController = {
  /* ============================================================
     GET ALL EMPLOYEES (With salary + position)
  ============================================================ */
  async getAll(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

      const { data, error } = await supabase
        .from("employees")
        .select(`
        id,
        full_name,
        phone,
        position,
        salary,
        created_at,

        salary_payments:employee_salary_payments (
          month,
          net_salary
        )
      `)
        .eq("tenant_id", tenant_id)
        .eq("salary_payments.month", currentMonth)   // joined table filter
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Convert joined result into simple boolean flag
      const employees = data.map(emp => ({
        ...emp,
        is_salary_paid_this_month: emp.salary_payments.length > 0
      }));

      return res.json({
        success: true,
        current_month: currentMonth,
        data: employees
      });

    } catch (err) {
      console.error("getAll employees error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  /* ============================================================
     GET ONE EMPLOYEE (includes salary + attendance)
  ============================================================ */
  async getOne(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { id } = req.params;

      // Employee details
      const { data: employee, error: empErr } = await supabase
        .from("employees")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("id", id)
        .single();

      if (empErr) return res.status(400).json({ error: "Employee not found" });

      // Salary details
      const { data: salary } = await supabase
        .from("employee_salary_master")
        .select("*")
        .eq("employee_id", id)
        .eq("tenant_id", tenant_id)
        .single();

      // Attendance summary
      const { data: attendance } = await supabase
        .from("employee_attendance")
        .select("id, date, check_in, check_out, status")
        .eq("tenant_id", tenant_id)
        .eq("employee_id", id)
        .order("date", { ascending: false })
        .limit(30);

      return res.json({
        success: true,
        employee,
        salary: salary || null,
        attendance: attendance || [],
      });
    } catch (err) {
      console.error("getOne error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  /* ============================================================
     CREATE EMPLOYEE
     (Also optionally create user login)
  ============================================================ */
  async create(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { full_name, phone, position, salary, create_login, email, password } = req.body;

      if (!full_name) {
        return res.status(400).json({ error: "Full name is required" });
      }

      let employee_id = null;
      let loginRecord = null;

      /* --------------------------------------------------------
         1. ✅ FIXED: If creating login, create user FIRST
      -------------------------------------------------------- */
      if (create_login && email && password) {
        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: userData, error: loginErr } = await supabase
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

        if (loginErr) throw loginErr;

        loginRecord = userData[0];
        employee_id = userData[0].id;  // ✅ Use user's UUID for employee
      }

      /* --------------------------------------------------------
         2. Create Employee (linked UUID if login, else auto-generated)
      -------------------------------------------------------- */
      const employeeData = {
        tenant_id,
        full_name,
        phone,
        position,
        salary,
        is_active: true,
      };

      // ✅ Only set ID if we have a user login (to link them)
      if (employee_id) {
        employeeData.id = employee_id;
      }

      const { data: employeeRow, error: empErr } = await supabase
        .from("employees")
        .insert([employeeData])
        .select();

      if (empErr) throw empErr;

      const employee = employeeRow[0];

      /* --------------------------------------------------------
         3. ✅ FIXED: Always create salary master if salary provided
      -------------------------------------------------------- */
      if (salary && Number(salary) > 0) {
        const { error: salaryMasterErr } = await supabase
          .from("employee_salary_master")
          .insert([
            {
              tenant_id,
              employee_id: employee.id,
              monthly_salary: salary,
              allowance: 0,
              deduction: 0,
            },
          ]);

        if (salaryMasterErr) {
          console.error("Salary master creation failed:", salaryMasterErr);
          // Don't fail - salary can be added later
        }
      }

      return res.json({
        success: true,
        employee,
        login: loginRecord,
        message: create_login
          ? "Employee created with login access"
          : "Employee created (no login)"
      });
    } catch (err) {
      console.error("create employee error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  /* ============================================================
     UPDATE EMPLOYEE
  ============================================================ */
  async update(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { id } = req.params;
      const { full_name, phone, position, salary, is_active } = req.body;

      const { data, error } = await supabase
        .from("employees")
        .update({ full_name, phone, position, salary, is_active })
        .match({ id, tenant_id })
        .select();

      if (error) throw error;

      // If salary changed → update salary master
      if (salary) {
        await supabase
          .from("employee_salary_master")
          .update({ monthly_salary: salary })
          .eq("employee_id", id)
          .eq("tenant_id", tenant_id);
      }

      return res.json({ success: true, data: data[0] });
    } catch (err) {
      console.error("update employee error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  /* ============================================================
     DELETE EMPLOYEE
     (Deletes attendance, salary master, salary payments)
  ============================================================ */
  async delete(req, res) {
    try {
      const tenant_id = req.user.tenant_id;
      const { id } = req.params;

      const { error } = await supabase
        .from("employees")
        .delete()
        .match({ id, tenant_id });

      if (error) throw error;

      return res.json({ success: true, message: "Employee deleted" });
    } catch (err) {
      console.error("delete employee error:", err);
      return res.status(500).json({ error: err.message });
    }
  },
};
