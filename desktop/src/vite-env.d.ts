/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Older Supabase projects call the publishable key "anon". */
  readonly VITE_SUPABASE_ANON_KEY?: string
}
