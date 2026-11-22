import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { mustEnv } from "./server";

// ✅ usar em Server Components (pages do /app)

export function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll(): any {
        return cookieStore.getAll();
      },
      // ⚠️ Server Component NÃO pode setar cookie → no-op
      setAll() { },
    },
  });
}
