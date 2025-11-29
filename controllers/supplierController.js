import { supabase } from "../supabase/supabaseClient.js";

// ✅ CREATE SUPPLIER
export const createSupplier = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });
    console.log(req.body);

    const {
      name,
      contact_person = "",
      phone = "",
      email = "",
      address = "",
    } = req.body;

    if (!name)
      return res.status(400).json({ error: "Supplier name is required" });

    const { data, error } = await supabase
      .from("suppliers")
      .insert([
        {
          tenant_id,
          name,
          contact_person,
          phone,
          email,
          address,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ data });
  } catch (err) {
    console.error("❌ createSupplier error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ✅ GET ALL SUPPLIERS (tenant scoped)
export const getSuppliers = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { search, limit = 100, offset = 0 } = req.query;

    let query = supabase
      .from("suppliers")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("id", { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ data });
  } catch (err) {
    console.error("❌ getSuppliers error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ✅ GET SINGLE SUPPLIER
export const getSupplierById = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .match({ id: Number(id), tenant_id })
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Supplier not found" });

    return res.json({ data });
  } catch (err) {
    console.error("❌ getSupplierById error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ✅ UPDATE SUPPLIER
export const updateSupplier = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { name, contact_person, phone, email, address } = req.body;

    const updatePayload = {
      ...(name && { name }),
      ...(contact_person && { contact_person }),
      ...(phone && { phone }),
      ...(email && { email }),
      ...(address && { address }),
    };

    const { data, error } = await supabase
      .from("suppliers")
      .update(updatePayload)
      .match({ id: Number(id), tenant_id })
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Supplier not found" });

    return res.json({ data });
  } catch (err) {
    console.error("❌ updateSupplier error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};

// ✅ DELETE SUPPLIER
export const deleteSupplier = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .match({ id: Number(id), tenant_id });

    if (error) throw error;

    return res.json({ message: "Supplier deleted successfully" });
  } catch (err) {
    console.error("❌ deleteSupplier error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
