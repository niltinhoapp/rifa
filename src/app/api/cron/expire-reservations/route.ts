import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

/**
 * Endpoint de higienização e liberação segura de reservas expiradas.
 * Pode ser acionado por Cron Jobs, Webhooks de expiração ou tarefas agendadas.
 *
 * Garantias de Segurança:
 * 1. Não libera reservas com pagamento confirmado ou em conciliação.
 * 2. Valida propriedade estrita (order_id) antes de liberar cada cota.
 * 3. Operação 100% atômica no PostgreSQL.
 */
export async function POST(req: Request) {
  const sb = await supabaseSSR();

  const body = await req.json().catch(() => null);
  const raffleId = body?.raffle_id ?? null;
  const orderId = body?.order_id ?? null;

  // Se foi fornecido um order_id específico para expiração pontual:
  if (orderId) {
    const { data, error } = await sb.rpc("expire_order_reservations", {
      p_order_id: orderId,
    });

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    const res = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      order_id: res?.order_id,
      numbers_released: res?.numbers_released ?? 0,
      was_expired: Boolean(res?.was_expired),
    });
  }

  // Execução em lote (cleanup geral ou por rifa)
  const { data, error } = await sb.rpc("cleanup_expired_reservations", {
    p_raffle_id: raffleId,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  const res = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    orders_expired: res?.orders_expired ?? 0,
    numbers_released: res?.numbers_released ?? 0,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
