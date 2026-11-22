// src/lib/supabase/ssr.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ✅ Route Handlers / Server Actions: PODE setar cookie
export function supabaseSSR() {
  const cookieStore = cookies() as any;

  return createServerClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll?.() ?? [];
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // ✅ forma mais compatível no Next:
            cookieStore.set({ name, value, ...options });
          });
        },
      },
    }
  );
}