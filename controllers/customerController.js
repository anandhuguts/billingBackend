import { supabase } from "../supabase/supabaseClient.js";

export const CustomerController = {
  /* ======================================================
     GET ALL CUSTOMERS (TENANT-BASED)
  ====================================================== */
  async getAll(req, res) {
    try {
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /* ======================================================
     CREATE CUSTOMER (WITH UNIQUE PHONE HANDLING)
  ====================================================== */
  async create(req, res) {
    try {
      const { tenant_id } = req.user;
      const body = req.body;

      const name = (body.name || "").trim();
      const phone = (body.phone || "").trim();
      const email = body.email ? body.email.trim() : null;

      if (!name || !phone) {
        return res.status(400).json({ error: "Name and phone are required" });
      }

      // Insert customer
      const { data, error } = await supabase
        .from("customers")
        .insert([
          {
            ...body,
            name,
            phone,
            email,
            tenant_id,
          },
        ])
        .select("*")
        .single();

      // Handle Supabase unique constraint error (Postgres code 23505)
      if (error && error.code === "23505") {
        return res.status(400).json({
          error: "Customer with this phone already exists for your store",
        });
      }

      if (error) throw error;

      return res.json({
        success: true,
        message: "Customer created successfully",
        data,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /* ======================================================
     GET SINGLE CUSTOMER
  ====================================================== */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .match({ id, tenant_id })
        .single();

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(404).json({ error: "Customer not found" });
    }
  },

  /* ======================================================
     UPDATE CUSTOMER (UNIQUE PHONE PROTECTED)
  ====================================================== */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;
      const body = req.body;

      const updateData = {
        ...body,
      };

      if (body.phone) updateData.phone = body.phone.trim();
      if (body.email) updateData.email = body.email.trim();
      if (body.name) updateData.name = body.name.trim();

      const { data, error } = await supabase
        .from("customers")
        .update(updateData)
        .match({ id, tenant_id })
        .select()
        .single();

      if (error && error.code === "23505") {
        return res.status(400).json({
          error: "Another customer already uses this phone number",
        });
      }

      if (error) throw error;

      return res.json({
        success: true,
        message: "Customer updated successfully",
        data,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /* ======================================================
     DELETE CUSTOMER
  ====================================================== */
  async delete(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      const { error } = await supabase
        .from("customers")
        .delete()
        .match({ id, tenant_id });

      if (error) throw error;

      return res.json({
        success: true,
        message: "Customer deleted",
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /* ======================================================
     SEARCH CUSTOMER (TENANT-BASED)
  ====================================================== */
  async search(req, res) {
    try {
      const { keyword } = req.params;
      const { tenant_id } = req.user;

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenant_id)
        .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`);

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
