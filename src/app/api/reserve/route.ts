import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

export async function POST(req: Request) {
  const sb = await supabaseSSR();

  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const phone = onlyDigits(String(body?.phone ?? ""));
  const rawNumbers = Array.isArray(body?.numbers) ? body.numbers : [];
  const numbers: number[] = rawNumbers
    .map((n: any) => Number(n))
    .filter((n: number) => Number.isInteger(n) && n > 0);

  if (!slug) {
    return NextResponse.json({ ok: false, message: "slug ausente" }, { status: 400 });
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ ok: false, message: "Nome deve ter pelo menos 2 caracteres" }, { status: 400 });
  }
  if (phone.length < 10) {
    return NextResponse.json({ ok: false, message: "WhatsApp inválido (DDD + número)" }, { status: 400 });
  }
  if (!numbers.length) {
    return NextResponse.json({ ok: false, message: "Selecione pelo menos 1 número" }, { status: 400 });
  }

  // Remove duplicados de forma determinística
  const uniqueNumbers = Array.from(new Set(numbers));

  // 1) Chamada Transacional à RPC de Reserva com Validade Estrita de 24 Horas
  // Bloqueio de linha FOR UPDATE determinístico no PostgreSQL
  const { data: rpcRows, error: rpcErr } = await sb.rpc("reserve_numbers_manual_24h", {
    p_raffle_slug: slug,
    p_buyer_name: name,
    p_buyer_phone: phone,
    p_numbers: uniqueNumbers,
  });

  if (rpcErr) {
    const errLower = (rpcErr.message ?? "").toLowerCase();
    const isConflict =
      errLower.includes("indisponível") ||
      errLower.includes("já está reservado") ||
      errLower.includes("já foi pago") ||
      errLower.includes("já reservado");

    return NextResponse.json(
      { ok: false, message: rpcErr.message },
      { status: isConflict ? 409 : 400 }
    );
  }

  const reservation = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!reservation?.order_id) {
    return NextResponse.json(
      { ok: false, message: "Falha inesperada ao processar reserva" },
      { status: 500 }
    );
  }

  // Busca instruções complementares de pagamento manual da rifa
  const { data: raffleMeta } = await sb
    .from("raffles")
    .select("payment_instructions, payment_mode")
    .eq("slug", slug)
    .single();

  return NextResponse.json({
    ok: true,
    order_id: reservation.order_id,
    public_token: reservation.public_token,
    reserved_at: reservation.reserved_at,
    expires_at: reservation.expires_at,
    total_cents: reservation.total_cents,
    numbers: uniqueNumbers,
    payment_instructions: raffleMeta?.payment_instructions ?? null,
  });
}
