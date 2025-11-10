// controllers/invoiceController.js
import { supabase } from "../supabase/supabaseClient.js";

// GET /api/invoices - Get all invoices with items
export const getAllInvoices = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(`
        *,
        invoice_items (
          *,
          products (
            name,
            brand,
            category,
            unit
          )
        )
      `)
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({
      success: true,
      data: invoices
    });
  } catch (err) {
    console.error("❌ Get invoices failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// DELETE /api/invoices/:id - Delete invoice
export const deleteInvoice = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Check if invoice exists
    const { data: existingInvoice, error: checkError } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("tenant_id", tenant_id)
      .eq("id", id)
      .single();

    if (checkError || !existingInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Delete invoice items first
    const { error: deleteItemsError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("invoice_id", id)
      .eq("tenant_id", tenant_id);

    if (deleteItemsError) throw deleteItemsError;

    // Delete invoice
    const { error: deleteInvoiceError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenant_id);

    if (deleteInvoiceError) throw deleteInvoiceError;

    return res.json({
      success: true,
      message: `✅ Invoice #${existingInvoice.invoice_number} deleted successfully!`
    });
  } catch (err) {
    console.error("❌ Invoice deletion failed:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};