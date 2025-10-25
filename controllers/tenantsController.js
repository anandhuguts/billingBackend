import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";

// GET all tenants
export const getAllTenants = async (req, res) => {
  const { data, error } = await supabase.from("tenants").select("*");
  if (error) return res.status(500).json({ error });
  res.json(data);
};

// GET single tenant
export const getTenantById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("tenants").select("*").eq("id", id).single();
  if (error) return res.status(404).json({ error: "Tenant not found" });
  res.json(data);
};

// CREATE tenant
export const createTenant = async (req, res) => {
  const { name, email, password, category, plan, status } = req.body;
  if (!name || !email || !password || !category) return res.status(400).json({ error: "Missing fields" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("tenants")
      .insert([{ name, email, password: hashedPassword, category, plan: plan || "trial", status: status || "active" }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ message: "Tenant created", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// UPDATE tenant
export const updateTenant = async (req, res) => {
  const { id } = req.params;
  const { name, email, password, category, plan, status, modules } = req.body;
  try {
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (category) updateData.category = category;
    if (plan) updateData.plan = plan;
    if (status) updateData.status = status;
    if (modules) updateData.modules = modules;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    const { data, error } = await supabase.from("tenants").update(updateData).eq("id", id).select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Tenant not found" });

    res.json({ message: "Tenant updated", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE tenant
export const deleteTenant = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from("tenants").delete().eq("id", id).select();
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Tenant not found" });
    res.json({ message: "Tenant deleted", tenant: data[0] });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
