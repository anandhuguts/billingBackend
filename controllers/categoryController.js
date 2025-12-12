import { supabase } from "../supabase/supabaseClient.js";

// CREATE CATEGORY
export const createCategory = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { name, description = "" } = req.body;

    if (!name) return res.status(400).json({ error: "Name required" });

    const { data, error } = await supabase
      .from("categories")
      .insert([{ tenant_id, name, description }])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ data });
  } catch (err) {
    console.error("createCategory error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// GET ALL CATEGORIES
export const getCategories = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;

    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("name");

    if (error) throw error;

    return res.json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// UPDATE CATEGORY
export const updateCategory = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;
    const { name, description } = req.body;

    const payload = {
      ...(name && { name }),
      ...(description !== undefined && { description }),
    };

    const { data, error } = await supabase
      .from("categories")
      .update(payload)
      .match({ id: Number(id), tenant_id })
      .select()
      .single();

    if (error) throw error;

    return res.json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE CATEGORY
export const deleteCategory = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const { id } = req.params;

    const { error } = await supabase
      .from("categories")
      .delete()
      .match({ id: Number(id), tenant_id });

    if (error) throw error;

    return res.json({ message: "Category deleted" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
