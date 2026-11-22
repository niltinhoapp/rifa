import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Comparação em tempo constante para mitigar ataques de temporização (Timing Attacks)
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Endpoint de Higienização de Reservas Expiradas (Regra de 24 Horas)
 * 
 * Proteções de Segurança Obrigatórias:
 * 1. CRON_SECRET é estritamente obrigatório. Se ausente ou vazio, retorna HTTP 500.
 * 2. Token recebido via Bearer ou Query é validado com comparação em tempo constante.
 * 3. Execução administrativa com SUPABASE_SERVICE_ROLE_KEY (não utiliza supabaseSSR).
 * 4. NUNCA registra segredos ou chaves em logs.
 * 5. NUNCA expira pedidos com pagamento confirmado.
 */
export async function POST(req: Request) {
  // 1. Validação estrita da presença de CRON_SECRET no servidor
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET não configurado no servidor" },
      { status: 500 }
    );
  }

  // 2. Extração e validação do token da requisição
  const authHeader = req.headers.get("authorization");
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret")?.trim() ?? "";
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const isBearerValid = bearerToken ? timingSafeEqualStr(bearerToken, cronSecret) : false;
  const isQueryValid = querySecret ? timingSafeEqualStr(querySecret, cronSecret) : false;

  if (!isBearerValid && !isQueryValid) {
    return NextResponse.json(
      { ok: false, message: "Acesso não autorizado" },
      { status: 401 }
    );
  }

  // 3. Inicialização segura do cliente administrativo
  let sbAdmin;
  try {
    sbAdmin = getSupabaseAdminClient();
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: "Falha na inicialização do cliente administrativo" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const raffleId = body?.raffle_id ?? null;

  // 4. Execução da RPC de higienização via service_role
  const { data, error } = await sbAdmin.rpc("cleanup_expired_reservations_24h", {
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
