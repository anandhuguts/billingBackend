import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";

// Allowed keys for settings (mirror your notification keys plus extras)
const SETTINGS_KEYS = [
  "user_id",
  "phone",
  "email_notification",
  "plan_expire_alert",
  "new_tenants",
  "system_updation",
  "full_name",
  "email",
];

// GET /settings/:userId  - fetch settings for a user
export const getSettings = async (req, res) => {
  try {
    const { id } = req.params; // expecting user id

    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", id)
      .maybeSingle();

    if (error) {
      console.error("getSettings supabase error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch settings", details: error });
    }

    // If a settings row exists return it
    if (data) return res.json(data);

    // If not found, try to fetch user data to prefill sensible defaults (full_name, email, etc)
    try {
      const { data: user, error: userErr } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("id", id)
        .maybeSingle();

      if (userErr) {
        console.warn(
          "getSettings: failed to fetch user for defaults:",
          userErr
        );
        return res.json({ user_id: id });
      }

      // Build default settings object limited to allowed keys
      const defaults = { user_id: id };
      if (user) {
        if (user.full_name) defaults.full_name = user.full_name;
        if (user.email) defaults.email = user.email;
      }

      return res.json(defaults);
    } catch (e) {
      console.error("getSettings fallback error:", e);
      return res.json({ user_id: id });
    }
  } catch (err) {
    console.error("getSettings error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// POST /settings  - create or update settings for a user
// Body should contain user_id plus any allowed keys
export const upsertSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const userId = body.user_id || req.body.userId || req.query.user_id;
    if (!userId) return res.status(400).json({ error: "user_id is required" });

    // Build sanitized payload only with allowed keys
    const payload = { user_id: userId };
    for (const k of SETTINGS_KEYS) {
      if (k === "user_id") continue;
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        payload[k] = body[k];
      }
    }

    // If some useful profile fields are missing (e.g. full_name), try to pull from users table
    try {
      const needsFullName =
        !Object.prototype.hasOwnProperty.call(payload, "full_name") ||
        !payload.full_name;
      const needsEmail =
        !Object.prototype.hasOwnProperty.call(payload, "email") ||
        !payload.email;
      if (needsFullName || needsEmail) {
        const { data: user, error: userErr } = await supabase
          .from("users")
          .select("id, full_name, email")
          .eq("id", userId)
          .maybeSingle();
        if (!userErr && user) {
          if (user.full_name && !payload.full_name)
            payload.full_name = user.full_name;
          if (user.email && !payload.email) payload.email = user.email;
        }
      }
    } catch (e) {
      console.warn("upsertSettings: could not preload user data", e);
      // continue without blocking the upsert
    }

    // Try upsert using user_id as unique key. If your DB does not have a unique
    // constraint on user_id, this will still work by selecting then updating/inserting.
    // We'll attempt an upsert but fall back to select+update if needed.
    try {
      const { data: upserted, error: upsertErr } = await supabase
        .from("settings")
        .upsert([payload], { onConflict: "user_id", ignoreDuplicates: false })
        .select()
        .maybeSingle();

      if (upsertErr) {
        // If upsert failed due to missing constraint, fallback to select+update/insert
        console.warn(
          "upsert failed, falling back to manual insert/update:",
          upsertErr
        );
      } else {
        return res.json({ message: "Settings saved", settings: upserted });
      }
    } catch (e) {
      console.warn("upsert exception, falling back:", e);
    }

    // Fallback: check if row exists then update/insert
    const { data: existing, error: fetchErr } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("upsert fetchErr:", fetchErr);
      return res
        .status(500)
        .json({ error: "Failed to save settings", details: fetchErr });
    }

    if (existing) {
      const { data: updated, error: updErr } = await supabase
        .from("settings")
        .update(payload)
        .eq("user_id", userId)
        .select()
        .maybeSingle();
      if (updErr) {
        console.error("settings update error:", updErr);
        return res
          .status(500)
          .json({ error: "Failed to update settings", details: updErr });
      }
      return res.json({ message: "Settings updated", settings: updated });
    }

    // Insert
    const { data: inserted, error: insErr } = await supabase
      .from("settings")
      .insert([payload])
      .select()
      .maybeSingle();
    if (insErr) {
      console.error("settings insert error:", insErr);
      return res
        .status(500)
        .json({ error: "Failed to insert settings", details: insErr });
    }

    return res.json({ message: "Settings created", settings: inserted });
  } catch (err) {
    console.error("upsertSettings error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};





// POST /users/:id/change-password
export const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: "current_password and new_password are required" });
    }

    // fetch user (including hashed password)
    const { data: userData, error: fetchErr } = await supabase
      .from("users")
      .select("id, password")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) {
      console.error("changePassword fetch error", fetchErr);
      return res.status(500).json({ error: "Failed to fetch user" });
    }
    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    const hashed = userData.password;
    // verify current password
    const match = await bcrypt.compare(current_password, hashed);
    if (!match) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // hash new password and update
    const newHashed = await bcrypt.hash(new_password, 10);
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ password: newHashed })
      .eq("id", id)
      .select();

    if (updateErr) {
      console.error("changePassword update error", updateErr);
      return res.status(500).json({ error: "Failed to update password", details: updateErr });
    }

    return res.json({ message: "Password updated" });
  } catch (err) {
    console.error("changePassword error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default {
  getSettings,
  upsertSettings,
};
