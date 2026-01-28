import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseEnvError =
  !supabaseUrl || !supabaseAnonKey
    ? "Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. Create frontend/.env from frontend/.env.example."
    : null

export const supabase: SupabaseClient | null =
  supabaseEnvError ? null : createClient(supabaseUrl!, supabaseAnonKey!)

