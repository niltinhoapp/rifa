import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = await supabaseSSR();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, message: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const paymentId = body?.payment_id;
  if (!paymentId) return NextResponse.json({ ok: false, message: "payment_id ausente" }, { status: 400 });

  // 1) pega payment + order + raffle_id
  const { data: pay, error: pErr } = await sb
    .from("payments")
    .select("id,status,order_id, orders:order_id(id,status,raffle_id,workspace_id)")
    .eq("id", paymentId)
    .single();

  if (pErr || !pay) return NextResponse.json({ ok: false, message: pErr?.message ?? "Pagamento não encontrado" }, { status: 404 });

  const order = (pay as any).orders;
  if (!order?.id) return NextResponse.json({ ok: false, message: "Pedido inválido" }, { status: 400 });

  // 2) marca payment como paid
  const { error: upPayErr } = await sb.from("payments").update({ status: "paid" }).eq("id", paymentId);
  if (upPayErr) return NextResponse.json({ ok: false, message: upPayErr.message }, { status: 400 });

  // 3) marca order como paid
  const { error: upOrdErr } = await sb.from("orders").update({ status: "paid" }).eq("id", order.id);
  if (upOrdErr) return NextResponse.json({ ok: false, message: upOrdErr.message }, { status: 400 });

  // 4) marca todos os números desse order como paid
  const { error: upNumsErr } = await sb
    .from("raffle_numbers")
    .update({ status: "paid", confirmed_at: new Date().toISOString() })
    .eq("order_id", order.id);

  if (upNumsErr) return NextResponse.json({ ok: false, message: upNumsErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}