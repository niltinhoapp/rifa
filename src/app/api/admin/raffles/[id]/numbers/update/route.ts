import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  if (!id || id === "undefined") {
    return NextResponse.json({ ok: false, message: "id inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);

  const action = String(body?.action ?? "");
  const number = Number(body?.number);

  const buyer_name = String(body?.buyer_name ?? "").trim() || null;
  const buyer_phone = String(body?.buyer_phone ?? "").trim() || null;

  if (!Number.isFinite(number) || number <= 0) {
    return NextResponse.json({ ok: false, message: "número inválido" }, { status: 400 });
  }

  if (!["reserve", "confirm", "free"].includes(action)) {
    return NextResponse.json({ ok: false, message: "ação inválida" }, { status: 400 });
  }

  // ✅ sessão via cookie do request
  const sb = await supabaseSSR(req);

  const { data: auth, error: aErr } = await sb.auth.getUser();
  if (aErr || !auth.user) {
    return NextResponse.json({ ok: false, message: "Não autenticado" }, { status: 401 });
  }

  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .select("id")
    .eq("id", id)
    .single();

  if (rErr || !raffle) {
    return NextResponse.json(
      { ok: false, message: rErr?.message ?? "Rifa não encontrada" },
      { status: 404 }
    );
  }

  if (action === "free") {
    const { error } = await sb
      .from("raffle_numbers")
      .update({
        status: "free",
        locked_until: null,
        buyer_name: null,
        buyer_phone: null,
        confirmed_at: null,
        order_id: null,
      })
      .eq("raffle_id", raffle.id)
      .eq("number", number);

    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reserve") {
    const { error } = await sb
      .from("raffle_numbers")
      .update({
        status: "reserved",
        buyer_name,
        buyer_phone,
        locked_until: null,
        confirmed_at: null,
        order_id: null,
      })
      .eq("raffle_id", raffle.id)
      .eq("number", number);

    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // action === "confirm"
  const { error } = await sb
    .from("raffle_numbers")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      buyer_name,
      buyer_phone,
    })
    .eq("raffle_id", raffle.id)
    .eq("number", number);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}