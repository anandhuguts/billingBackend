// controllers/notificationcontroller.js
import { supabase } from "../supabase/supabaseClient.js";

// Allowed keys exactly as in your jsonb column
const NOTIFICATION_KEYS = [
  "email_notification",
  "plan_expired",
  "new_tenant_registration",
  "system_updates",
];

// Defaults you showed in your table screenshot
const DEFAULTS = {
  email_notification: true,
  plan_expired: true,
  new_tenant_registration: true,
  system_updates: true,
};

/**
 * GET /tenants/:id/notifications
 * Returns merged preferences: DB value overlaid on DEFAULTS.
 */
export const getNotifications = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("tenants")
      .select("notification")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("getNotifications supabase error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch tenant preferences" });
    }

    if (!data) return res.status(404).json({ error: "Tenant not found" });

    const dbPrefs = data.notification || {};
    const merged = { ...DEFAULTS, ...dbPrefs };
    return res.json(merged);
  } catch (err) {
    console.error("getNotifications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /tenants/:id/notifications
 * Partially updates preferences; only whitelisted keys are accepted.
 * Payload example:
 * { "email_notification": true, "system_updates": false }
 */
export const updateNotifications = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    // Sanitize/whitelist and coerce to boolean
    const patch = {};
    for (const key of NOTIFICATION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        patch[key] = !!body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res
        .status(400)
        .json({ error: "No valid notification fields in request body" });
    }
    // Read current preferences, merge in JS, then write back to avoid direct DB JSONB ops
    const { data: current, error: fetchErr } = await supabase
      .from("tenants")
      .select("notification")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) {
      console.error("updateNotifications fetch error:", fetchErr);
      return res.status(500).json({ error: "Failed to fetch tenant" });
    }

    if (!current) return res.status(404).json({ error: "Tenant not found" });

    const mergedPrefs = { ...(current.notification || {}), ...patch };

    const { data: updated, error: updateErr } = await supabase
      .from("tenants")
      .update({ notification: mergedPrefs })
      .eq("id", id)
      .select("notification")
      .maybeSingle();

    if (updateErr) {
      console.error("updateNotifications update error:", updateErr);
      return res.status(500).json({ error: "Failed to update preferences" });
    }

    const merged = { ...DEFAULTS, ...(updated.notification || {}) };
    return res.json({ message: "Preferences updated", data: merged });
  } catch (err) {
    console.error("updateNotifications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
