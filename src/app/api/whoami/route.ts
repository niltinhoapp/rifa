import { NextResponse } from "next/server";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const runtime = "nodejs";

export async function GET() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getUser();
  return NextResponse.json({
    ok: true,
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  });
}
