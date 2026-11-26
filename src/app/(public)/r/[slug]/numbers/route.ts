import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const sb = supabaseAnon();

  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .select("id,slug,status")
    .eq("slug", slug)
    .single();

  if (rErr || !raffle) {
    return NextResponse.json(
      { ok: false, message: rErr?.message ?? "Rifa não encontrada" },
      { status: 404 }
    );
  }

  const { data: numbers, error: nErr } = await sb
    .from("raffle_numbers")
    .select("number,status,locked_until,buyer_name")
    .eq("raffle_id", raffle.id)
    .in("status", ["free", "reserved", "paid"])
    .order("number", { ascending: true });

  if (nErr) {
    return NextResponse.json({ ok: false, message: nErr.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, numbers: numbers ?? [] },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}
