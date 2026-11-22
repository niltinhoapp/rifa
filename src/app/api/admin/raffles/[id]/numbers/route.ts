import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || id === "undefined" || !isUuid(id)) {
    return NextResponse.json({ ok: false, message: "id inválido" }, { status: 400 });
  }

  const sb = await supabaseSSR(req);

  const { data: auth, error: aErr } = await sb.auth.getUser();
  if (aErr || !auth.user) {
    return NextResponse.json({ ok: false, message: "Não autenticado" }, { status: 401 });
  }

  // 1) Busca a rifa (RLS protege)
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

  // 2) Busca os números (limite pra evitar payload gigante)
  // Se precisar paginação depois, trocamos por range(page*size, ...)
  const { data: numbers, error: nErr } = await sb
    .from("raffle_numbers")
    .select("number,status,locked_until,buyer_name,buyer_phone,confirmed_at")
    .eq("raffle_id", raffle.id)
    .order("number", { ascending: true })
    .limit(5000);

  if (nErr) {
    return NextResponse.json({ ok: false, message: nErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, raffle, numbers: numbers ?? [] });
}