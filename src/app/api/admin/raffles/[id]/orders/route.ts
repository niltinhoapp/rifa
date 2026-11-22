import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Listagem de Pedidos de uma Rifa para o Painel Administrativo
 * Retorna pedidos com cotas agrupadas, prazo de 24h restante e status.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;

  if (!id || id === "undefined") {
    return NextResponse.json({ ok: false, message: "id inválido" }, { status: 400 });
  }

  const sb = await supabaseSSR(req);
  const { data: auth, error: aErr } = await sb.auth.getUser();
  if (aErr || !auth?.user) {
    return NextResponse.json({ ok: false, message: "Não autenticado" }, { status: 401 });
  }

  // 1. Busca a rifa (RLS valida workspace)
  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .select("id, title, slug, price_cents")
    .eq("id", id)
    .single();

  if (rErr || !raffle) {
    return NextResponse.json({ ok: false, message: "Rifa não encontrada" }, { status: 404 });
  }

  // 2. Busca pedidos ordenados por data
  const { data: orders, error: oErr } = await sb
    .from("orders")
    .select(`
      id,
      public_token,
      buyer_name,
      buyer_phone,
      total_cents,
      status,
      expires_at,
      created_at,
      reserved_at,
      order_items ( number )
    `)
    .eq("raffle_id", id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (oErr) {
    return NextResponse.json({ ok: false, message: oErr.message }, { status: 400 });
  }

  const formattedOrders = (orders ?? []).map((ord: any) => ({
    id: ord.id,
    public_token: ord.public_token,
    buyer_name: ord.buyer_name,
    buyer_phone: ord.buyer_phone,
    total_cents: ord.total_cents,
    status: ord.status,
    expires_at: ord.expires_at,
    created_at: ord.created_at,
    reserved_at: ord.reserved_at ?? ord.created_at,
    numbers: (ord.order_items ?? []).map((it: any) => it.number).sort((a: number, b: number) => a - b),
  }));

  return NextResponse.json({ ok: true, orders: formattedOrders });
}
