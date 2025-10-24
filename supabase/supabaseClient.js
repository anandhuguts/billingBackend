// supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load .env first
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY are required in .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
