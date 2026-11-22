import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = await supabaseSSR();

  const { data: auth, error: aErr } = await sb.auth.getUser();
  if (aErr || !auth.user) {
    return NextResponse.json(
      { ok: false, message: "Não autenticado" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ ok: false, message: "id ausente" }, { status: 400 });
  }

  const patch: any = {
    title: body.title ?? null,
    description: body.description ?? null,
    prize_title: body.prize_title ?? null,
    prize_description: body.prize_description ?? null,
    draw_date: body.draw_date ?? null,
    payment_mode: body.payment_mode ?? null,
    payment_instructions: body.payment_instructions ?? null,
  };

  // só atualiza total_numbers se veio valor
  if (body.total_numbers != null) {
    const n = Number(body.total_numbers);
    patch.total_numbers = Number.isFinite(n) && n > 0 ? n : 100;
  }

  const { error } = await sb.from("raffles").update(patch).eq("id", body.id);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}