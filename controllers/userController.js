import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";

export const getAllUsers = async (req, res) => {
  const { data, error } = await supabase.from("users").select("*");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

export const getUser = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "User not found" });
  res.json(data);
};

export const createUser = async (req, res) => {
  try {
    const { full_name, email, password, role, tenant_id, is_active } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });
    const hashed = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          full_name,
          email,
          password: hashed,
          role: role || "user",
          tenant_id: tenant_id || null,
          is_active: is_active ?? true,
        },
      ])
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ user: data[0] });
  } catch (err) {
    console.error("createUser error", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    console.log("updateUser called", { id, updates });
    if (!Object.keys(updates).length)
      return res.status(400).json({ error: "No fields to update" });
    if (updates.password)
      updates.password = await bcrypt.hash(updates.password, 10);

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id)
      .select();
    console.log("supabase update result", { data, error });

    if (error) {
      // Log and return full error for debugging (remove details in production)
      try {
        console.error(
          "updateUser supabase error",
          JSON.stringify(error, null, 2)
        );
      } catch (e) {
        console.error("Failed to stringify supabase error", e);
      }
      return res
        .status(500)
        .json({ error: "Failed to update user", details: error });
    }

    if (!data || data.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ user: data[0] });
  } catch (err) {
    console.error("updateUser error", err);
    return res
      .status(500)
      .json({ error: "Internal server error", details: String(err) });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("users")
    .delete()
    .eq("id", id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0)
    return res.status(404).json({ error: "User not found" });
  res.json({ message: "User deleted", user: data[0] });
};
