import { supabase } from "../supabase/supabaseClient.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// LOGIN controller
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    // 1️⃣ Fetch user
    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = users[0];
    console.log("User found:", user.email, "Tenant ID:", user.tenant_id,user);

    // 2️⃣ Compare passwords
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 3️⃣ Create JWT with tenant_id
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
          full_name: user.full_name,

        role: user.role,
        tenant_id: user.tenant_id,  // 🧩 add tenant ID inside the token
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // 4️⃣ Optionally, store token in session (if using express-session)
    // req.session.user = {
    //   id: user.id,
    //   email: user.email,
    //   role: user.role,
    //   tenant_id: user.tenant_id,  // 🧩 store tenant_id here too
    // };

    // 5️⃣ Send response
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,  // include for frontend use
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
