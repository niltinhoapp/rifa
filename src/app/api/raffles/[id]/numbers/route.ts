import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const id = params?.id;

  if (!id || id === "undefined") {
    return NextResponse.json({ ok: false, message: "id inválido" }, { status: 400 });
  }

  // ✅ IMPORTANTÍSSIMO: passar o req pra pegar cookies do header (senão dá 401)
  const sb = await supabaseSSR(req);

  const { data: auth, error: aErr } = await sb.auth.getUser();
  if (aErr || !auth.user) {
    return NextResponse.json({ ok: false, message: "Não autenticado" }, { status: 401 });
  }

  // meta da rifa (RLS garante que só membro/dono enxerga)
  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .select("id,slug,status,total_numbers,reserve_unit,reserve_value,draw_date")
    .eq("id", id)
    .single();

  if (rErr || !raffle) {
    return NextResponse.json(
      { ok: false, message: rErr?.message ?? "Rifa não encontrada" },
      { status: 404 }
    );
  }

  // lista números
  const { data: numbers, error: nErr } = await sb
    .from("raffle_numbers")
    .select("number,status,locked_until,buyer_name,buyer_phone,confirmed_at")
    .eq("raffle_id", raffle.id)
    .order("number", { ascending: true });

  if (nErr) {
    return NextResponse.json({ ok: false, message: nErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, raffle, numbers: numbers ?? [] });
}