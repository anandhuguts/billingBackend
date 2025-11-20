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
     CREATE CUSTOMER (TENANT-BASED)
  ====================================================== */
  async create(req, res) {
    try {
      const body = req.body;
      const { tenant_id } = req.user;

      if (!body.name || !body.phone) {
        return res.status(400).json({ error: "Name and phone are required" });
      }

      const customerData = {
        ...body,
        tenant_id,
      };

      const { data, error } = await supabase
        .from("customers")
        .insert([customerData])
        .select("*");

      if (error) throw error;

      return res.json({
        success: true,
        message: "Customer created successfully",
        data: data[0],
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
     UPDATE CUSTOMER
  ====================================================== */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { tenant_id } = req.user;

      const updateValues = req.body;

      const { data, error } = await supabase
        .from("customers")
        .update(updateValues)
        .match({ id, tenant_id })
        .select();

      if (error) throw error;

      return res.json({
        success: true,
        message: "Customer updated successfully",
        data: data[0],
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
        .match({ tenant_id })
        .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`);

      if (error) throw error;

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
