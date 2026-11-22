import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseCookieHeader(cookieHeader: string) {
  const out: { name: string; value: string }[] = [];
  const parts = (cookieHeader ?? "").split(";");

  for (const p of parts) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const name = p.slice(0, i).trim();
    const value = p.slice(i + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

/**
 * ✅ Route Handler: passe req => lê cookie do header
 * ✅ Server Action / Server Component: sem req => usa cookies() do Next
 */
export async function supabaseSSR(req?: Request) {
  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // 1) Route Handler (tem req)
  if (req) {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookieList = parseCookieHeader(cookieHeader);

    return createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieList;
        },
        setAll() {
          // aqui não precisa (o refresh fica por conta do fluxo do app)
        },
      },
    });
  }

  // 2) Server Action / Server Component (sem req)
  const store = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        // Server Actions podem precisar persistir refresh token
        cookiesToSet.forEach(({ name, value, options }) => {
          store.set({ name, value, ...options });
        });
      },
    },
  });
}