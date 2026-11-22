import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

/**
 * Endpoint de Higienização de Reservas Expiradas (Regra de 24 Horas)
 * 
 * Proteções de Segurança:
 * 1. Autenticação via CRON_SECRET no cabeçalho Authorization ou parâmetro de query.
 * 2. NUNCA expira pedidos com pagamento confirmado.
 * 3. Libera estritamente as cotas associadas ao pedido expirado (order_id).
 * 4. Operação 100% transacional no PostgreSQL.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken !== cronSecret && querySecret !== cronSecret) {
      return NextResponse.json({ ok: false, message: "Acesso não autorizado" }, { status: 401 });
    }
  }

  const sb = await supabaseSSR();
  const body = await req.json().catch(() => null);
  const raffleId = body?.raffle_id ?? null;

  // Execução da RPC de higienização de 24 horas
  const { data, error } = await sb.rpc("cleanup_expired_reservations_24h", {
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
