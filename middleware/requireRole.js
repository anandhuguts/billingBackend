import { supabase } from "../supabase/supabaseClient.js";

// requireRole middleware: use like `requireRole('super_admin')`.
// It first checks the decoded JWT on `req.user` (set by verifyToken).
// If the token already contains a `role` claim and it matches, allow.
// Otherwise, it fetches the authoritative role from the `users` table.
export const requireRole = (allowedRoles) => {
  // If passed single string, convert to array
  if (!Array.isArray(allowedRoles)) {
    allowedRoles = [allowedRoles];
  }

  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user || !user.id) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // 1️⃣ Check role from token first
      if (user.role && allowedRoles.includes(user.role)) {
        return next();
      }

      // 2️⃣ Otherwise check DB for role
      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("requireRole error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }

      if (!data || !allowedRoles.includes(data.role)) {
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
