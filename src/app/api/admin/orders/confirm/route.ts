import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

/**
 * Confirmação Manual de Pedido pelo Administrador
 * 
 * Regras Obrigatórias:
 * 1. Verifica autenticação de administrador via cookie SSR.
 * 2. Bloqueia confirmação se o pedido expirou (expires_at <= clock_timestamp()).
 * 3. Valida integridade total: todas as cotas devem continuar reservadas para este pedido.
 * 4. Atualização atômica conjunta: orders ('paid'), payments ('confirmed'), raffle_numbers ('paid').
 * 5. Idempotência estrita: se já confirmado, retorna sucesso sem duplicar.
 */
export async function POST(req: Request) {
  const sb = await supabaseSSR();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) {
    return NextResponse.json(
      { ok: false, message: "Não autenticado" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const orderId = body?.order_id;

  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json(
      { ok: false, message: "order_id ausente ou inválido" },
      { status: 400 }
    );
  }

  // Invoca a RPC transacional com identidade do administrador autenticado
  const { data: rpcRows, error: rpcErr } = await sb.rpc("confirm_order_manual", {
    p_order_id: orderId,
    p_admin_id: auth.user.id,
  });

  if (rpcErr) {
    return NextResponse.json(
      { ok: false, message: rpcErr.message },
      { status: 400 }
    );
  }

  const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  return NextResponse.json({
    ok: true,
    order_id: result?.order_id,
    numbers_confirmed: result?.numbers_confirmed ?? 0,
    already_confirmed: Boolean(result?.already_confirmed),
  });
}
