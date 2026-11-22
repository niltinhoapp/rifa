import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("ENV do Supabase ausente (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).");
  }

  return createClient(url, anon);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params; // ✅ Next 16: params é Promise

  if (!slug || slug === "undefined") {
    return NextResponse.json({ ok: false, message: "slug inválido" }, { status: 400 });
  }

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

  // se quiser bloquear rifa inativa no público:
  // if (raffle.status !== "active") {
  //   return NextResponse.json({ ok: false, message: "Rifa inativa" }, { status: 400 });
  // }

  const { data: numbers, error: nErr } = await sb
    .from("raffle_numbers")
    .select("number,status,locked_until,buyer_name")
    .eq("raffle_id", raffle.id)
    .order("number", { ascending: true });

  if (nErr) {
    return NextResponse.json({ ok: false, message: nErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, numbers: numbers ?? [] });
}