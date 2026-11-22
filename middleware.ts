import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({
    request: { headers: req.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // ✅ forma correta no Next 16
          res.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  // 🔄 força sync/refresh quando necessário
  await supabase.auth.getUser();

  return res;
}

export const config = {
  matcher: ["/app/:path*", "/api/admin/:path*"],
};