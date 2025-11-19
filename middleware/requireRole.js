import { supabase } from "../supabase/supabaseClient.js";

// requireRole middleware: use like `requireRole('super_admin')`.
// It first checks the decoded JWT on `req.user` (set by verifyToken).
// If the token already contains a `role` claim and it matches, allow.
// Otherwise, it fetches the authoritative role from the `users` table.
export const requireRole = (expectedRole) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user || !user.id) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // If the JWT included a role, trust it (the token is already verified).
      if (user.role && user.role === expectedRole) {
        return next();
      }

      // Otherwise fetch the user's role from the DB to be authoritative.
      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("requireRole: failed to read user role:", error);
        return res.status(500).json({ error: "Internal server error" });
      }

      if (!data || data.role !== expectedRole) {
        return res
          .status(403)
          .json({ error: "Forbidden: insufficient privileges" });
      }

      return next();
    } catch (err) {
      console.error("requireRole error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  };
};

export default requireRole;
