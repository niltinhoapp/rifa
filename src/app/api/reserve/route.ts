import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

export async function POST(req: Request) {
  const sb = await supabaseSSR();

  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const phone = onlyDigits(String(body?.phone ?? ""));
  const numbers: number[] = Array.isArray(body?.numbers) ? body.numbers.map((n: any) => Number(n)) : [];

  if (!slug) return NextResponse.json({ ok: false, message: "slug ausente" }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, message: "nome ausente" }, { status: 400 });
  if (phone.length < 10) return NextResponse.json({ ok: false, message: "whatsapp inválido" }, { status: 400 });
  if (!numbers.length) return NextResponse.json({ ok: false, message: "nenhum número selecionado" }, { status: 400 });

  // 1) carrega rifa pública
  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .select("id,workspace_id,price_cents,total_numbers,status,reserve_unit,reserve_value,draw_date,payment_mode,payment_instructions")
    .eq("slug", slug)
    .single();

  if (rErr || !raffle) return NextResponse.json({ ok: false, message: "Rifa não encontrada" }, { status: 404 });
  if (raffle.status !== "active") return NextResponse.json({ ok: false, message: "Rifa não encontrada ou inativa" }, { status: 400 });

  const now = new Date();

  // 2) calcula expires_at / locked_until
  let expiresAt: Date;
  if (raffle.reserve_unit === "days") {
    expiresAt = addDays(now, Math.max(0, Number(raffle.reserve_value ?? 1)));
  } else if (raffle.reserve_unit === "until_draw") {
    if (!raffle.draw_date) return NextResponse.json({ ok: false, message: "Rifa sem data de sorteio" }, { status: 400 });
    expiresAt = new Date(raffle.draw_date);
  } else {
    // minutes (default)
    expiresAt = addMinutes(now, Math.max(5, Number(raffle.reserve_value ?? 15)));
  }

  // 3) cria order + payment
  const totalCents = (raffle.price_cents ?? 0) * numbers.length;
  const publicToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const { data: order, error: oErr } = await sb
    .from("orders")
    .insert({
      workspace_id: raffle.workspace_id,
      raffle_id: raffle.id,
      public_token: publicToken,
      buyer_name: name,
      buyer_phone: phone,
      total_cents: totalCents,
      status: "pending",
      expires_at: expiresAt.toISOString(),
    })
    .select("id,public_token,expires_at,total_cents")
    .single();

  if (oErr) return NextResponse.json({ ok: false, message: oErr.message }, { status: 400 });

  const { data: payment, error: payErr } = await sb
    .from("payments")
    .insert({
      order_id: order.id,
      method: "pix_manual",
      status: "pending",
      proof_url: null,
    })
    .select("id,status")
    .single();

  if (payErr) return NextResponse.json({ ok: false, message: payErr.message }, { status: 400 });

  // 4) trava números (só se estiverem livres ou expirados)
  // OBS: isso é o "básico"; o ideal é RPC transacional (mais seguro).
  const lockedUntilIso = expiresAt.toISOString();

  // busca os números
  const { data: rows, error: nErr } = await sb
    .from("raffle_numbers")
    .select("id,number,status,locked_until")
    .eq("raffle_id", raffle.id)
    .in("number", numbers);

  if (nErr) return NextResponse.json({ ok: false, message: nErr.message }, { status: 400 });

  // valida disponibilidade
  for (const row of rows ?? []) {
    const isPaid = row.status === "paid";
    const isReserved = row.status === "reserved";
    const expired = row.locked_until ? new Date(row.locked_until) < now : true;

    if (isPaid) return NextResponse.json({ ok: false, message: `Número ${row.number} já está pago` }, { status: 409 });
    if (isReserved && !expired) return NextResponse.json({ ok: false, message: `Número ${row.number} já está reservado` }, { status: 409 });
  }

  // atualiza para reservado e vincula ao order
  const { error: lockErr } = await sb
    .from("raffle_numbers")
    .update({
      status: "reserved",
      locked_until: lockedUntilIso,
      order_id: order.id,
      buyer_name: name,
      buyer_phone: phone,
    })
    .eq("raffle_id", raffle.id)
    .in("number", numbers);

  if (lockErr) return NextResponse.json({ ok: false, message: lockErr.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      public_token: order.public_token,
      expires_at: order.expires_at,
      total_cents: order.total_cents,
    },
    payment,
    payment_instructions: raffle.payment_instructions ?? null,
  });
}