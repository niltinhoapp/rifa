import { NextResponse } from "next/server";
import { supabaseSSR } from "@/lib/supabase/ssr";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = await supabaseSSR();

  // 1) Validação de autenticação de administrador
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) {
    return NextResponse.json(
      { ok: false, message: "Não autenticado" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const paymentId = body?.payment_id;

  if (!paymentId || typeof paymentId !== "string") {
    return NextResponse.json(
      { ok: false, message: "payment_id ausente ou inválido" },
      { status: 400 }
    );
  }

  // 2) Execução Transacional Atômica via RPC no PostgreSQL
  // Corrige inconsistência de enums (payment_status: 'confirmed', order_status: 'paid', number_status: 'paid')
  // Garante idempotência e bloqueio FOR UPDATE evitando confirmação de números já liberados ou de outro pedido
  const { data: rpcRows, error: rpcErr } = await sb.rpc("confirm_payment_atomic", {
    p_payment_id: paymentId,
    p_confirmed_by: auth.user.id,
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
    payment_id: result?.payment_id,
    numbers_confirmed: result?.numbers_confirmed ?? 0,
    already_confirmed: Boolean(result?.already_confirmed),
  });
}
